import type { Meta, StoryObj } from "@storybook/react";
import { MemoryCard } from "../src/components/memory/MemoryCard";

const meta: Meta<typeof MemoryCard> = { title: "Memory/MemoryCard", component: MemoryCard, parameters: { layout: "centered" } };
export default meta;
type Story = StoryObj<typeof MemoryCard>;

export const Fact: Story = { args: { name: "User prefers Python", type: "fact", scope: "user", confidence: "explicit", status: "active" } };
export const Archived: Story = { args: { name: "Old API choice", type: "fact", scope: "project", confidence: "inferred", status: "archived" } };
export const Selected: Story = { args: { name: "FastAPI preference", type: "semantic", scope: "user", confidence: "observed", status: "active", selected: true } };
