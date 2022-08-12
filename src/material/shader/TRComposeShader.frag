alpha = velocityDisocclusion > 0.001 ? (alpha - 0.05) : (alpha + 0.05);
alpha = clamp(alpha, 0., 1.);

float m = blend;

if (velocityDisocclusion > 0.2) m -= max(0.5, velocityDisocclusion) - 0.2;

m = clamp(m, 0., 1.);

outputColor = accumulatedColor * m + inputColor * (1. - m);

outputColor = undoColorTransform(outputColor);