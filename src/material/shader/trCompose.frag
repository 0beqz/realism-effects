const float alphaStep = 0.001;
const float depthDiffThreshold = 0.000005;

alpha = didReproject && depthDiff <= depthDiffThreshold ? (alpha + alphaStep) : 0.0;

float s = alpha / alphaStep + 1.0;
float m = 1. - 1. / s;

m = min(m, blend);

outputColor = mix(inputColor, accumulatedColor, m);

// outputColor = vec3(alpha);