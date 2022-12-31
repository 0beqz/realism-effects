gOutput = vec4(undoColorTransform(outputColor), alpha);

const vec3 W = vec3(0.2125, 0.7154, 0.0721);
float l = dot(inputTexel.rgb, W);
l = max(0.001, l);

if (isReprojectedUvValid) {
    float momentsTemporalResolveMix = max(temporalResolveMix, 0.8);

    vec4 historyMoments = textureLod(lastMomentsTexture, reprojectedUv, 0.);

    vec2 momentsDiffuse = vec2(0.);
    momentsDiffuse.r = dot(gOutput.rgb, W);
    momentsDiffuse.g = momentsDiffuse.r * momentsDiffuse.r;

    momentsDiffuse = mix(momentsDiffuse, historyMoments.rg, momentsTemporalResolveMix);

    vec3 specular = textureLod(specularTexture, vUv, 0.).rgb;

    vec4 lastSpecularTexel = textureLod(lastSpecularTexture, reprojectedUv, 0.);
    vec3 lastSpecular = lastSpecularTexel.rgb;
    float alpha = max(lastSpecularTexel.a, 1.);

    if (dot(specular, specular) > 0.0) alpha += 1.0;

    temporalResolveMix = 1. - 1. / alpha;
    temporalResolveMix = min(temporalResolveMix, blend);

    if (dot(specular, specular) == 0.0) specular = lastSpecular;
    gOutput2 = vec4(mix(specular, lastSpecular, temporalResolveMix), alpha);

    vec2 momentsSpecular = vec2(0.);
    momentsSpecular.r = dot(gOutput2.rgb, W);
    momentsSpecular.g = momentsSpecular.r * momentsSpecular.r;

    momentsSpecular = mix(momentsSpecular, historyMoments.ba, 0.);

    gMoment = vec4(momentsDiffuse, momentsSpecular);
} else {
    // boost new samples
    gMoment = vec4(0., 1., 0., 1.);
    gOutput2 = textureLod(specularTexture, vUv, 1.);
}

// gOutput.xyz = didMove ? vec3(0., 1., 0.) : vec3(0., 0., 0.);

// float variance = max(0.0, gMoment.a - gMoment.b * gMoment.b);
// variance = abs(variance);
// gOutput.xyz = vec3(variance);