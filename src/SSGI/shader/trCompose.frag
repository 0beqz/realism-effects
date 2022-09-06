// if (alpha < 0.1)
//     outputColor = vec3(0., 1., 0.);
// else
//     outputColor = vec3(0.);

outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);