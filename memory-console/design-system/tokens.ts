export const tokens = {
  colors: {
    memory: { active: "#22c55e", warning: "#f59e0b", conflict: "#ef4444", archived: "#71717a" },
    layer: { fact: "#3b82f6", semantic: "#a855f7", trigger: "#f97316", episode: "#22c55e" },
    risk: { low: "#22c55e", medium: "#f59e0b", high: "#ef4444", critical: "#dc2626" },
  },
  spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px", "2xl": "48px" },
  typography: {
    fontFamily: { display: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', monospace" },
    fontSize: { xs: "0.75rem", sm: "0.875rem", base: "1rem", lg: "1.125rem", xl: "1.25rem", "2xl": "1.5rem", "3xl": "2rem" },
  },
  motion: { fast: "150ms", normal: "200ms", slow: "300ms", ease: "cubic-bezier(0.16, 1, 0.3, 1)" },
} as const;
