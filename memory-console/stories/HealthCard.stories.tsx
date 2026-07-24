import type { Meta, StoryObj } from "@storybook/react";
import { HealthCard } from "../src/components/dashboard/HealthCard";

const meta: Meta<typeof HealthCard> = { title: "Dashboard/HealthCard", component: HealthCard, parameters: { layout: "centered" } };
export default meta;
type Story = StoryObj<typeof HealthCard>;

export const Memories: Story = { args: { title: "Memories", value: "12,542", subtitle: "active units", color: "green" } };
export const Conflicts: Story = { args: { title: "Conflicts", value: "12", subtitle: "open", color: "amber" } };
export const RiskLow: Story = { args: { title: "Risk Level", value: "Low", subtitle: "all clear", color: "green" } };
