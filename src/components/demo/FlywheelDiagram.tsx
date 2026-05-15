import Image from "next/image";

export default function FlywheelDiagram() {
  return (
    <div className="flex justify-center w-full">
      <Image
        src="/flywheel-diagram.png"
        alt="AI decisioning loop: Nexus app feeds daily customer-level decisions to the marketing automation platform, which delivers communications to identified customers, whose interactions flow back through a warehouse or CDP as first-party data to Nexus"
        width={1400}
        height={852}
        className="w-full max-w-3xl h-auto"
        priority
      />
    </div>
  );
}
