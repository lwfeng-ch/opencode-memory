"use client";

interface PipelineStage {
  name: string;
  status: string;
}

const statusColors: Record<string, string> = {
  running: "bg-green-500",
  healthy: "bg-green-500",
  idle: "bg-zinc-500",
  waiting: "bg-amber-500",
  error: "bg-red-500",
};

export function PipelineStatus({
  stages,
}: {
  stages: PipelineStage[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-400">
        Pipeline Status
      </h3>
      {stages.map((stage) => (
        <div
          key={stage.name}
          className="flex items-center justify-between py-1"
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                statusColors[stage.status] ?? "bg-zinc-500"
              }`}
            />
            <span className="text-sm text-zinc-300">{stage.name}</span>
          </div>
          <span className="text-xs text-zinc-500">{stage.status}</span>
        </div>
      ))}
    </div>
  );
}
