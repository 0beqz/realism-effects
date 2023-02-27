#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

vec4 moment, historyMoment;

bool lastReprojectedUvSpecular, isReprojectedUvSpecular;

for (int i = 0; i < momentTextureCount; i++) {
    isReprojectedUvSpecular = reprojectSpecular[i] && inputTexel[i].a != 0.0 && reprojectedUvSpecular[i].x >= 0.0;

    reprojectedUv = isReprojectedUvSpecular ? reprojectedUvSpecular[i] : reprojectedUvDiffuse;

    if (i == 0) {
        historyMoment = textureLod(lastMomentTexture, reprojectedUv, 0.);
    } else if (lastReprojectedUvSpecular != isReprojectedUvSpecular) {
        historyMoment.ba = textureLod(lastMomentTexture, reprojectedUv, 0.).ba;
    }

    lastReprojectedUvSpecular = isReprojectedUvSpecular;
}

if (reprojectedUvDiffuse.x >= 0.0 || reprojectedUvSpecular[0].x >= 0.0) {
    moment.r = luminance(gOutput[0].rgb);
    moment.g = moment.r * moment.r;

#if textureCount > 1
    moment.b = luminance(gOutput[1].rgb);
    moment.a = moment.b * moment.b;
#endif
} else {
    moment.rg = vec2(0., 10.);
    moment.ba = vec2(0., 10.);
}

float momentTemporalReprojectMix = max(blend, 0.8);
gMoment = mix(moment, historyMoment, momentTemporalReprojectMix);

// if (reprojectedUvDiffuse.x < 0. && dot(inputTexel[0].rgb, inputTexel[0].rgb) != 0.0) {
//     gOutput0.rgb = vec3(0., 1., 0.);
// }

// float variance = max(0.0, gMoment.a - gMoment.b * gMoment.b);
// gOutput0.xyz = vec3(variance);