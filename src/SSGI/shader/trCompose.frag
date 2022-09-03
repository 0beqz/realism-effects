float m = blend;

float s = alpha / alphaStep + 1.0;
m = 1. - 1. / s;
m = min(m, blend);

#ifdef boxBlur
boxBlurredColor += inputColor;
if (alpha <= 0.05) inputColor = boxBlurredColor;
#endif

outputColor = mix(inputColor, accumulatedColor, m);

// if (alpha < 0.1)
//     outputColor = vec3(0., 1., 0.);
// else
//     outputColor = vec3(0.);
