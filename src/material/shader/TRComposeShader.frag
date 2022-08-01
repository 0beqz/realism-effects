// the compose shader when Temporal Resolve is enabled
alpha = velocityDisocclusion > 0.005 ? (alpha - 0.25) : (alpha + 0.01);
alpha = saturate(alpha);

if (isBackground) alpha = 1.;

outputColor = accumulatedTexel.rgb * blend + inputTexel.rgb * (1. - blend);