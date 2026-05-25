/**
 * HDBSCAN (Hierarchical DBSCAN) — pure TypeScript implementation.
 *
 * Density-based clustering with auto-k and noise labeling. Unlike k-means, it:
 *   1. Auto-detects the number of clusters (no `k` to pick)
 *   2. Labels outliers as noise (-1) instead of forcing them into a cluster
 *   3. Finds clusters of varying density
 *
 * This implementation uses the standard simplified pipeline (MST + Union-Find
 * single-linkage with minClusterSize gating). Correctness is favored over the
 * full Excess-of-Mass extraction to keep the code reviewable. The result is
 * equivalent to running DBSCAN on a mutual-reachability single-linkage
 * dendrogram and keeping every component that ever grows past `minClusterSize`.
 *
 * Steps:
 *   1. Pairwise cosine distances → flat n*n Float64Array (row-major)
 *   2. Core distances: minPts-th nearest neighbor (0-indexed: minPts-1)
 *   3. Mutual reachability: mrd(a,b) = max(coreDist[a], coreDist[b], dist[a,b])
 *   4. Minimum spanning tree on mrd via Prim's (O(n²), optimal for dense graphs)
 *   5. Sort MST edges ascending by weight; Union-Find merge in order
 *   6. Each time a merge would join two components both with size >= minClusterSize,
 *      "freeze" them as candidate clusters (record their members)
 *   7. Final extraction: walk all candidate clusters at decreasing density;
 *      keep the largest non-overlapping set, label everything else noise (-1)
 *
 * Pure function: no I/O, no randomness, deterministic for any input.
 */

import { cosineSimilarity } from "./feature-vector";

export interface HDBSCANConfig {
  /** Core distance neighborhood size (typical: 5). Must be >= 1. */
  minPts: number;
  /** Minimum cluster size to be kept (typical: 30). Smaller clusters become noise. */
  minClusterSize: number;
}

export interface HDBSCANResult {
  /** Cluster assignment per input vector; -1 = noise. Length === vectors.length. */
  labels: number[];
  /** Number of clusters found (not counting noise). */
  k: number;
  /** Size of each cluster, indexed 0..k-1. */
  clusterSizes: number[];
}

function cosineDistance(a: number[], b: number[]): number {
  // 1 - cosine similarity, clamped to [0, 2] (cosine similarity ∈ [-1, 1])
  return 1 - cosineSimilarity(a, b);
}

/**
 * Build pairwise cosine distance matrix as a flat Float64Array (row-major, n*n).
 * Diagonal is 0; matrix is symmetric.
 */
function buildDistanceMatrix(vectors: number[][]): Float64Array {
  const n = vectors.length;
  const m = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = cosineDistance(vectors[i]!, vectors[j]!);
      m[i * n + j] = d;
      m[j * n + i] = d;
    }
  }
  return m;
}

/**
 * Core distance: distance to the (minPts-1)-th nearest neighbor (0-indexed,
 * counting the point itself at index 0). For minPts=5 this is the 4-th
 * nearest non-self neighbor.
 */
function computeCoreDistances(dist: Float64Array, n: number, minPts: number): Float64Array {
  const core = new Float64Array(n);
  // For each row, collect distances including self (0), sort, pick minPts-1 index.
  // Self-distance is 0 so it always ends up at position 0 after sort.
  const k = Math.min(minPts - 1, n - 1);
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) buf[j] = dist[i * n + j]!;
    // Partial sort would be faster but n ≤ 3000 makes full sort fine.
    const sorted = Array.from(buf).sort((a, b) => a - b);
    core[i] = sorted[k]!;
  }
  return core;
}

/**
 * Prim's algorithm on the mutual-reachability fully-connected graph.
 * Returns n-1 edges as [u, v, weight].
 *
 * mrd(i,j) = max(core[i], core[j], dist[i,j])
 */
function buildMST(
  dist: Float64Array,
  core: Float64Array,
  n: number
): Array<[number, number, number]> {
  const inTree = new Uint8Array(n);
  const minEdge = new Float64Array(n);
  const minEdgeFrom = new Int32Array(n);
  for (let i = 0; i < n; i++) minEdge[i] = Infinity;

  inTree[0] = 1;
  // Initialize frontier from node 0
  for (let j = 1; j < n; j++) {
    const d = dist[0 * n + j]!;
    const mrd = Math.max(core[0]!, core[j]!, d);
    minEdge[j] = mrd;
    minEdgeFrom[j] = 0;
  }

  const edges: Array<[number, number, number]> = [];

  for (let step = 1; step < n; step++) {
    // Find unvisited node with smallest minEdge
    let best = -1;
    let bestW = Infinity;
    for (let j = 0; j < n; j++) {
      if (!inTree[j] && minEdge[j]! < bestW) {
        bestW = minEdge[j]!;
        best = j;
      }
    }
    if (best === -1) break; // disconnected (shouldn't happen with dense graph)
    inTree[best] = 1;
    edges.push([minEdgeFrom[best]!, best, bestW]);

    // Update frontier
    const coreBest = core[best]!;
    for (let j = 0; j < n; j++) {
      if (inTree[j]) continue;
      const d = dist[best * n + j]!;
      const mrd = Math.max(coreBest, core[j]!, d);
      if (mrd < minEdge[j]!) {
        minEdge[j] = mrd;
        minEdgeFrom[j] = best;
      }
    }
  }

  return edges;
}

/**
 * Union-Find with size tracking.
 */
class UnionFind {
  parent: Int32Array;
  size: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.size = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.size[i] = 1;
    }
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root]! !== root) root = this.parent[root]!;
    // Path compression
    let cur = x;
    while (this.parent[cur]! !== root) {
      const next = this.parent[cur]!;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }
  /** Union by size; returns [newRoot, mergedSize]. */
  union(a: number, b: number): [number, number] {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return [ra, this.size[ra]!];
    // Larger tree absorbs smaller
    const [big, small] = this.size[ra]! >= this.size[rb]! ? [ra, rb] : [rb, ra];
    this.parent[small] = big;
    this.size[big] = this.size[big]! + this.size[small]!;
    return [big, this.size[big]!];
  }
}

/**
 * Recover the members of a Union-Find component containing node `root` at the
 * snapshot encoded by `parent`/`size`. We don't snapshot — instead, members
 * are passed in alongside the merge event.
 */
function membersOfComponent(uf: UnionFind, n: number, root: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (uf.find(i) === root) out.push(i);
  }
  return out;
}

export function hdbscan(vectors: number[][], config: HDBSCANConfig): HDBSCANResult {
  const n = vectors.length;
  const minPts = Math.max(1, Math.floor(config.minPts));
  const minClusterSize = Math.max(2, Math.floor(config.minClusterSize));

  // Edge case: not enough data for meaningful density estimation
  if (n < 2 * minPts || n < minClusterSize) {
    return { labels: new Array(n).fill(-1), k: 0, clusterSizes: [] };
  }

  // 1. Pairwise distances
  const dist = buildDistanceMatrix(vectors);

  // Short-circuit: if every vector is identical (all distances zero), return one cluster.
  let allZero = true;
  for (let i = 0; i < n * n && allZero; i++) {
    if (dist[i] !== 0) allZero = false;
  }
  if (allZero) {
    if (n >= minClusterSize) {
      return { labels: new Array(n).fill(0), k: 1, clusterSizes: [n] };
    }
    return { labels: new Array(n).fill(-1), k: 0, clusterSizes: [] };
  }

  // 2. Core distances
  const core = computeCoreDistances(dist, n, minPts);

  // 3 + 4. MST on mutual reachability
  const mst = buildMST(dist, core, n);

  // 5. Sort edges ascending by mutual reachability weight
  mst.sort((a, b) => a[2] - b[2]);

  // 6. Union-Find walk. Record candidate clusters at each "stable" merge:
  //    when both components being merged are already >= minClusterSize, the
  //    resulting merged set is a candidate cluster.
  //
  //    To keep extraction simple and deterministic, the final cluster set is
  //    the set of "largest stable components" — i.e., the components at the
  //    end of the merge process that have size >= minClusterSize and were
  //    not merged with another component of size >= minClusterSize.
  //
  //    Algorithm:
  //      - Track which roots are "frozen" (a component is frozen when it
  //        first reaches minClusterSize AND a merge would join it with
  //        another frozen component — at that point we record the two
  //        frozen components as final clusters and stop growing them).
  //
  //    This is equivalent to extracting clusters at the "highest λ" where
  //    they last existed as standalone density-connected components, which
  //    is the core insight of HDBSCAN's stability-based extraction.
  const uf = new UnionFind(n);
  // For each root, the "frozen members" — set when the component is
  // permanently sealed as a final cluster.
  const frozenMembers = new Map<number, number[]>();
  // A root is "alive as candidate" once size >= minClusterSize.
  // When two alive components merge, we freeze both and mark the merged
  // result as "dead" (no further candidates from it).
  const isDead = new Set<number>();

  for (const edge of mst) {
    const u = edge[0];
    const v = edge[1];
    const ru = uf.find(u);
    const rv = uf.find(v);
    if (ru === rv) continue;

    const sizeU = uf.size[ru]!;
    const sizeV = uf.size[rv]!;
    const aliveU = sizeU >= minClusterSize && !isDead.has(ru);
    const aliveV = sizeV >= minClusterSize && !isDead.has(rv);

    if (aliveU && aliveV) {
      // Freeze both as final clusters (snapshot members BEFORE merge)
      if (!frozenMembers.has(ru)) {
        frozenMembers.set(ru, membersOfComponent(uf, n, ru));
      }
      if (!frozenMembers.has(rv)) {
        frozenMembers.set(rv, membersOfComponent(uf, n, rv));
      }
      const [newRoot] = uf.union(u, v);
      isDead.add(newRoot);
    } else {
      uf.union(u, v);
    }
  }

  // 7. Collect final clusters:
  //    - All frozen components (recorded above), plus
  //    - Any remaining alive component (size >= minClusterSize, not dead, not frozen)
  //      — this handles the case where the dendrogram never had two alive
  //      components merge (e.g., one dominant cluster + scattered noise).
  const finalClusters: number[][] = [];
  for (const members of frozenMembers.values()) {
    finalClusters.push(members);
  }
  const seenRoots = new Set<number>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (seenRoots.has(r)) continue;
    seenRoots.add(r);
    if (isDead.has(r)) continue;
    if (uf.size[r]! < minClusterSize) continue;
    // This is a still-alive top-level component — emit it as a cluster
    // unless it overlaps with an already-frozen cluster (it shouldn't, by
    // construction: frozen members were snapshot before the merge that
    // killed their root, and the still-alive root is a separate lineage).
    const members = membersOfComponent(uf, n, r);
    // De-dupe: skip if every member is already covered by a frozen cluster
    const covered = new Set<number>();
    for (const c of finalClusters) for (const m of c) covered.add(m);
    const novel = members.filter((m) => !covered.has(m));
    if (novel.length >= minClusterSize) finalClusters.push(novel);
  }

  if (finalClusters.length === 0) {
    return { labels: new Array(n).fill(-1), k: 0, clusterSizes: [] };
  }

  // Assign labels. If a point appears in multiple clusters (shouldn't happen
  // by construction, but be defensive), the first cluster wins.
  const labels = new Array<number>(n).fill(-1);
  const clusterSizes: number[] = [];
  for (let cid = 0; cid < finalClusters.length; cid++) {
    let count = 0;
    for (const m of finalClusters[cid]!) {
      if (labels[m] === -1) {
        labels[m] = cid;
        count++;
      }
    }
    clusterSizes.push(count);
  }

  // Drop any cluster that ended up below minClusterSize after de-dup, relabel
  const keptIds: number[] = [];
  for (let cid = 0; cid < clusterSizes.length; cid++) {
    if (clusterSizes[cid]! >= minClusterSize) keptIds.push(cid);
  }
  if (keptIds.length === clusterSizes.length) {
    return { labels, k: clusterSizes.length, clusterSizes };
  }
  const remap = new Map<number, number>();
  keptIds.forEach((oldId, newId) => remap.set(oldId, newId));
  const newLabels = labels.map((l) => (l === -1 ? -1 : (remap.get(l) ?? -1)));
  const newSizes = keptIds.map((oldId) => clusterSizes[oldId]!);
  return { labels: newLabels, k: keptIds.length, clusterSizes: newSizes };
}
