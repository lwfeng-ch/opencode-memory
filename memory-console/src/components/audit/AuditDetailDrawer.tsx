"use client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { RiskBadge } from "@/components/governance/RiskBadge";
import type { AuditEvent } from "@/types/governance";

export function AuditDetailDrawer({ event, open, onClose }: { event: AuditEvent | null; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="bg-zinc-950 border-zinc-800 text-zinc-100 w-[400px] sm:w-[540px]">
        {event && (
          <>
            <SheetHeader>
              <SheetTitle className="text-zinc-100 flex items-center gap-2">
                {event.action} <RiskBadge risk={event.risk} />
              </SheetTitle>
              <SheetDescription className="text-zinc-400">{event.id}</SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Actor</div>
                  <div className="text-sm text-zinc-200">{event.actor}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Result</div>
                  <div className={`text-sm ${event.result === "success" ? "text-green-400" : "text-red-400"}`}>{event.result}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Time</div>
                  <div className="text-sm text-zinc-200">{new Date(event.timestamp).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Risk</div>
                  <RiskBadge risk={event.risk} />
                </div>
              </div>
              <div className="pt-3 border-t border-zinc-800">
                <div className="text-xs text-zinc-500 mb-1">Detail</div>
                <p className="text-sm text-zinc-200">{event.detail}</p>
              </div>
              {event.snapshotHash && (
                <div className="pt-3 border-t border-zinc-800">
                  <div className="text-xs text-zinc-500 mb-1">Snapshot</div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-zinc-300 bg-zinc-900 rounded px-2 py-1">{event.snapshotHash}</code>
                    <span className="text-xs text-green-400">● Rollback available</span>
                  </div>
                </div>
              )}
              <Button variant="outline" className="w-full border-zinc-700 text-zinc-300 mt-4" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
