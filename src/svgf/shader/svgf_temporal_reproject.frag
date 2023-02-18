
// gDiffuse = vec4(mix(inputColor, accumulatedColor, reprojectedUv.x != -1. ? temporalReprojectMix : 0.0), alpha);

// #if !defined(diffuseOnly) && !defined(specularOnly)
// // specular
// vec4 specularTexel = dot(inputTexel.rgb, inputTexel.rgb) == 0.0 ? textureLod(specularTexture, uv, 0.) : vec4(0.);
// vec3 specularColor = transformColor(specularTexel.rgb);
// float rayLength = specularTexel.a;

// // specular UV
// vec2 specularUv = reprojectedUv;
// if (rayLength != 0.0) {
//     vec2 hitPointUv = reprojectHitPoint(worldPos, rayLength, depth);

//     if (validateReprojectedUV(hitPointUv, depth, worldPos, worldNormal)) {
//         specularUv = hitPointUv;
//         historyMoment.ba = textureLod(lastMomentTexture, specularUv, 0.).ba;
//     }
// }

// vec3 lastSpecular;
// float specularAlpha = 1.0;

// if (specularUv.x != -1.) {
//     vec4 lastSpecularTexel = sampleReprojectedTexture(lastSpecularTexture, specularUv);

//     lastSpecular = transformColor(lastSpecularTexel.rgb);
//     specularAlpha = max(1., lastSpecularTexel.a);

//     // check if specular was sampled for this texel this frame
//     if (dot(specularColor, specularColor) != 0.0) {
//         specularAlpha++;
//     } else {
//         specularColor = lastSpecular;
//     }

//     temporalReprojectMix = min(1. - 1. / specularAlpha, maxValue);

//     float roughness = inputTexel.a;
//     float glossines = max(0., 0.025 - roughness) / 0.025;
//     temporalReprojectMix *= 1. - glossines * glossines;
// }

// gSpecular = vec4(mix(specularColor, lastSpecular, specularUv.x != -1. ? temporalReprojectMix : 0.), specularAlpha);
// gSpecular.rgb = undoColorTransform(gSpecular.rgb);

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

vec4 moment, historyMoment;
bool lastReprojectedUvSpecular, isReprojectedUvSpecular;

for (int i = 0; i < 2; i++) {
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

    moment.b = luminance(gOutput[1].rgb);
    moment.a = moment.b * moment.b;
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
// variance = abs(variance);
// gDiffuse.xyz = vec3(variance);