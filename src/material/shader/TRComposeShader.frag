// the compose shader when Temporal Resolve is enabled
alpha = velocityDisocclusion > 0.001 ? (alpha - 0.1) : (alpha + 0.05);
alpha = saturate(alpha);

float m = blend;

// prevents the blur of moving meshes by reducing the blend factor in proportion to the movement
const float threshold = 0.01;
if (alpha < 0.75 && movement > threshold) {
    m -= min((movement - threshold) * 4., 0.5);
}

if (movement < FLOAT_EPSILON && velocityDisocclusion < FLOAT_EPSILON) m = 0.975;

m = saturate(m);

outputColor = accumulatedTexel.rgb * m + inputTexel.rgb * (1. - m);

outputColor = transformToColor(outputColor);

// outputColor = velocity.bbb;

// outputColor = vec3(velocityDisocclusion);