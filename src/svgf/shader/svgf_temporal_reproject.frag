vec4 moment;

if (!reset && reprojectedUvDiffuse.x >= 0.0) {
    vec4 historyMoment = sampleReprojectedTexture(lastMomentTexture, reprojectedUvDiffuse);
    moment.r = luminance(gOutput[0].rgb);
    moment.g = moment.r * moment.r;

#if textureCount > 1
    moment.b = luminance(gOutput[1].rgb);
    moment.a = moment.b * moment.b;
#endif

    gMoment = mix(moment, historyMoment, 0.8);
} else {
    moment.rg = vec2(0., 1000.);
    moment.ba = vec2(0., 1000.);

    gMoment = moment;
    return;
}

// float variance = max(0.0, gMoment.a - gMoment.b * gMoment.b);
// gOutput0.xyz = vec3(variance);
