"use client";

import { useState } from "react";
import { LifecycleBadge } from "./LifecycleBadge";
import { ApprovalDiff } from "@/components/governance/ApprovalDiff";

interface TimelineEventProps {
  action: string;
  timestamp: string;
  actor: string;
  detail?: string;
  isLast?: boolean;
  beforeContent?: string;
  afterContent?: string;
}

export function TimelineEvent({ action, timestamp, actor, detail, isLast, beforeContent, afterContent }: TimelineEventProps) {
  const [showDiff, setShowDiff] = useState(false);
  const hasDiff = !!(beforeContent && afterContent);

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-3 h-3 rounded-full bg-zinc-700 border-2 border-zinc-600 flex-shrink-0 mt-1" />
        {!isLast && <div className="w-px flex-1 bg-zinc-800" />}
      </div>
      <div className="pb-6 flex-1">
        <div className="flex items-center gap-2">
          <LifecycleBadge action={action} />
          <span className="text-xs text-zinc-500">{new Date(timestamp).toLocaleDateString()}</span>
          <span className="text-xs text-zinc-600">{new Date(timestamp).toLocaleTimeString()}</span>
        </div>
        <div className="text-xs text-zinc-500 mt-1">Actor: {actor}</div>
        {detail && <div className="text-xs text-zinc-400 mt-1">{detail}</div>}
        {hasDiff && (
          <button onClick={() => setShowDiff(!showDiff)} className="text-xs text-blue-400 hover:text-blue-300 mt-1 transition-colors">
            {showDiff ? "Hide diff" : "View diff"}
          </button>
        )}
        {hasDiff && showDiff && (
          <div className="mt-2">
            <ApprovalDiff before={beforeContent} after={afterContent} />
          </div>
        )}
      </div>
    </div>
  );
}
