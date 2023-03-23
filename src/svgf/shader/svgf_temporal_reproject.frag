vec4 moment;

if (!reset && reprojectedUvDiffuse.x >= 0.0) {
    vec4 historyMoment = sampleReprojectedTexture(lastMomentTexture, reprojectedUvDiffuse, didMove ? SAMPLING_BLOCKY : SAMPLING_CATMULL_ROM);
    moment.r = luminance(gOutput[0].rgb);
    moment.g = moment.r * moment.r;

#if textureCount > 1
    moment.b = luminance(gOutput[1].rgb);
    moment.a = moment.b * moment.b;
#endif

    gMoment = mix(moment, historyMoment, 0.8);
} else {
    moment.rg = vec2(0., 5000.);
    moment.ba = vec2(0., 5000.);

    gMoment = moment;
    return;
}

// if (reprojectedUvDiffuse.x < 0. && dot(inputTexel[0].rgb, inputTexel[0].rgb) != 0.0) {
//     gOutput0.rgb = vec3(0., 1., 0.);
// }

// float variance = max(0.0, gMoment.a - gMoment.b * gMoment.b);
// gOutput0.xyz = vec3(variance);
