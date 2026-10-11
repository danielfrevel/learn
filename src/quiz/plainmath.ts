const SYMBOLS: Record<string, string> = {
  to: "→", infty: "∞", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
  cdot: "·", times: "×", pm: "±", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆",
  cup: "∪", cap: "∩", forall: "∀", exists: "∃", sum: "Σ", prod: "Π", int: "∫",
  partial: "∂", nabla: "∇", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

function rewrite(math: string): string {
  let s = math;
  for (let i = 0; i < 10 && /\\frac\{/.test(s); i++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  }
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(/\\([A-Za-z]+)/g, (_, name: string) => SYMBOLS[name] ?? name);
  return s.replace(/\s+/g, " ").trim();
}

export function plainMath(text: string): string {
  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m: string) => rewrite(m))
    .replace(/\$([^$\n]+?)\$/g, (_, m: string) => rewrite(m))
    .trim();
}
