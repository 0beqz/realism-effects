// the compose shader when Temporal Resolve is enabled
float alpha = 1.;

outputColor = accumulatedTexel.rgb * blend + inputTexel.rgb * (1. - blend);

// if (isBackground) {
//     outputColor = vec3(0., 1., 0.);
// }
// outputColor = texture2D(velocityTexture, vUv).rgb;