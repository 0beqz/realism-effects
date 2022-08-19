float depthDiff = abs(depth - lastDepth) * 1000.;

alpha = depthDiff <= 0.05 ? (alpha + 0.01) : 0.0;
alpha = clamp(alpha, 0.0, 1.0);

float m = blend;

float currentSample = alpha / 0.01 + 1.0;
m = 1. - 1. / (currentSample * 1.0);

if (alpha <= 0.1) inputColor = boxBlurredColor;

outputColor = accumulatedColor * m + inputColor * (1.0 - m);

// if (depthDiff > 0.05) outputColor = vec3(0., 1., 0.);

// outputColor = vec3(depthDiff);