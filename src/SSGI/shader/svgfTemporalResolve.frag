gOutput = vec4(undoColorTransform(outputColor), alpha);

const vec3 W = vec3(0.2125, 0.7154, 0.0721);
float l = dot(inputTexel.rgb, W);
l = max(0.001, l);
bool isDiffuseSample = inputTexel.a == 1.0;

if (isReprojectedUvValid) {
    vec4 historyMoments = textureLod(lastMomentsTexture, reprojectedUv, 0.);

    float diffuseWeight = historyMoments.b + (isDiffuseSample ? l : 0.);
    float specularWeight = historyMoments.a + (isDiffuseSample ? 0. : l);

    vec2 moments = vec2(0.);
    moments.r = dot(gOutput.rgb, W);
    moments.g = moments.r * moments.r;

    temporalResolveMix = max(temporalResolveMix, 0.8);

    moments = mix(moments, historyMoments.rg, temporalResolveMix);

    gMoment = vec4(moments, diffuseWeight, specularWeight);
} else {
    float diffuseWeight = isDiffuseSample ? l : 0.;
    float specularWeight = isDiffuseSample ? 0. : l;
    // boost new samples
    gMoment = vec4(0., 1., diffuseWeight, specularWeight);
}

// gOutput.xyz = didMove ? vec3(0., 1., 0.) : vec3(0., 0., 0.);

// float variance = max(0.0, gMoment.g - gMoment.r * gMoment.r);
// variance = abs(variance);
// gOutput.xyz = vec3(variance);