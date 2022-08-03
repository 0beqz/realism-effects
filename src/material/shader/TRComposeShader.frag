// the compose shader when Temporal Resolve is enabled
alpha = velocityDisocclusion > 0.001 ? (alpha - 0.05) : (alpha + 0.05);
alpha = clamp(alpha, 0., 1.);

float m = blend;

// prevents the blur of moving meshes by reducing the blend factor in proportion to the movement
// const float threshold = 0.01;
// if (alpha < 0.75 && movement > threshold) {
//     m -= min((movement - threshold) * 4., 0.5);
// }

if (!isMoving) m = max(0.975, m);

m = clamp(m, 0., 1.);

outputColor = accumulatedTexel.rgb * m + inputTexel.rgb * (1. - m);

outputColor = transformToColor(outputColor);

// outputColor = vec3(velocityDisocclusion);