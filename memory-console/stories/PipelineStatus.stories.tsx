import type { Meta, StoryObj } from "@storybook/react";
import { PipelineStatus } from "../src/components/dashboard/PipelineStatus";

const meta: Meta<typeof PipelineStatus> = { title: "Dashboard/PipelineStatus", component: PipelineStatus };
export default meta;
type Story = StoryObj<typeof PipelineStatus>;

export const AllRunning: Story = {
  args: { stages: [
    { name: "Capture", status: "running", lastRun: "2m ago" },
    { name: "Extraction", status: "healthy", lastRun: "15m ago" },
    { name: "Dream", status: "idle", lastRun: "3h ago" },
    { name: "Governance", status: "waiting", lastRun: null },
  ]}
};
