# Persona Discovery

How users are clustered into personas using unsupervised ML.

## Feature Vector — 10 Dimensions

```mermaid
block-beta
  columns 2
  block:CHANNEL["Channel Rates [0–1]"]:1
    C0["[0] push conv rate"]
    C1["[1] email conv rate"]
  end
  block:TIMING["Timing Ratios [2–4]"]:1
    T2["[2] morning ratio\nhours 5–11 share"]
    T3["[3] evening ratio\nhours 17–22 share"]
    T4["[4] weekend ratio\nSun+Sat share"]
  end
  block:BEHAVIOR["Behavioral Scalars [5–6]"]:1
    B5["[5] overall conv rate"]
    B6["[6] recency score\n1 − days_since_open/90"]
  end
  block:SEMANTIC["Semantic / YouVersion [7–9]"]:1
    S7["[7] giving tier\n0=none  0.5=giver  1=sower"]
    S8["[8] spiritual depth\nmean(streak+plan+prayer\n+scripture+badge)"]
    S9["[9] engagement freq\nlog-scaled decisions/week"]
  end
```

## Discovery Algorithm

Discovery is orchestrated by `discoverPersonas()` in `src/lib/services/persona-service.ts`
and triggered by `POST /api/personas/discover` (admin-only) or the
`/api/cron/discover-personas` cron. It supports two clustering algorithms; **HDBSCAN is the
default**, with k-means available as an explicit fallback (`config.algorithm: "kmeans"`).

```mermaid
flowchart TD
    START([POST /api/personas/discover<br/>or /api/cron/discover-personas]) --> LOAD[Load TrackedUser rows with<br/>totalDecisions >= minInteractions default 20]
    LOAD --> VECS[Compute 10-dim featureVector per user]
    VECS --> SAMPLE[Fisher-Yates downsample to<br/>maxSampleSize default 3000 if larger]

    SAMPLE --> ALGO{config.algorithm?}

    ALGO -->|hdbscan default| HDB[HDBSCAN src/lib/engine/hdbscan.ts<br/>minPts=5, minClusterSize=30<br/>density-based; finds k automatically;<br/>labels noise points as -1]
    ALGO -->|kmeans fallback| KM[k-means sweep k = minK..maxK<br/>runKMeans stabilityRuns each<br/>keep k with best silhouette]

    HDB --> SIL{silhouette gate}
    KM --> SIL
    SIL -->|k>1 and silhouette < 0.25| ABORT[Abort: no clusters saved]
    SIL -->|pass; k=1 accepted| TRAITS

    TRAITS[deriveTrait per cluster centroid:<br/>- Dominant channel push vs email<br/>- Peak hour morning→9 evening→20 mixed→14<br/>- Engagement level from freq dim 9<br/>- Giver profile from giving tier dim 7<br/>- Spiritual depth from composite dim 8]

    TRAITS --> COLORS[Assign colors cycling blue→green→purple→<br/>orange→pink→red→teal→yellow]

    COLORS --> UPSERT[Upsert Persona records<br/>source: discovered, centroid, clusterSize,<br/>silhouetteScore, traits, discoveredAt;<br/>deactivate extra stale discovered personas]

    UPSERT --> ASSIGN[batchAssignPersonas:<br/>For each TrackedUser, find nearest<br/>discovered centroid by cosine similarity]

    ASSIGN --> CONF[Confidence scaling:<br/>effectiveConf = similarity × min 1, decisions/20]
    CONF --> THRESH{effectiveConf >= threshold?}
    THRESH -->|yes| PERSIST[UPDATE TrackedUser:<br/>personaId, personaConfidence, personaAssignedAt]
    THRESH -->|no| SKIP[User remains unassigned]
```

**HDBSCAN vs. k-means.** HDBSCAN is density-based: it finds the cluster count automatically,
tolerates clusters of varying size, and labels low-density points as noise (`-1`, excluded
from centroids and the silhouette calculation). k-means requires a fixed `k`, so the fallback
path sweeps `k = minK..maxK` (default 3..15) running `runKMeans` `stabilityRuns` times per `k`
and keeps the `k` with the best silhouette score. Both gate on a minimum silhouette of `0.25`
(a single-cluster HDBSCAN result `k=1` is accepted without the gate, since `minClusterSize`
already guarantees density). `TrackedUser` is the Prisma model mapped to the `User` table.

## Cosine Similarity

Used for both cluster assignment and persona assignment:

```
similarity(u, v) = (u · v) / (|u| × |v|)

Range: 0.0 (orthogonal) to 1.0 (identical direction)
```

Users with similar channel preferences, timing patterns, and engagement level
will have feature vectors pointing in the same direction → high cosine similarity.

## Persona Color Palette (cycling)

| Index | Color | Tailwind classes |
|-------|-------|-----------------|
| 0 | blue | bg-blue-100 text-blue-700 border-blue-200 |
| 1 | green | bg-green-100 text-green-700 border-green-200 |
| 2 | purple | bg-purple-100 text-purple-700 border-purple-200 |
| 3 | orange | bg-orange-100 text-orange-700 border-orange-200 |
| 4 | pink | bg-pink-100 text-pink-700 border-pink-200 |
| 5 | red | bg-red-100 text-red-700 border-red-200 |
| 6 | teal | bg-teal-100 text-teal-700 border-teal-200 |
| 7 | yellow | bg-yellow-100 text-yellow-700 border-yellow-200 |

## Engagement Level Buckets

Derived from `featureVector[9]` (log-scaled engagement frequency, range 0–1):

| Level | Condition |
|-------|-----------|
| `daily` | freq > 0.7 |
| `regular` | 0.5 < freq ≤ 0.7 |
| `moderate` | 0.3 < freq ≤ 0.5 |
| `weekly` | 0.15 < freq ≤ 0.3 |
| `sporadic` | freq ≤ 0.15 |
