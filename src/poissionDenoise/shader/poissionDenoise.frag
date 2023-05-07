varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform float depthPhi;
uniform float normalPhi;

#include <common>

vec3 getWorldPos(float depth, vec2 coord) {
    float z = depth * 2.0 - 1.0;
    vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

    // Perspective division
    vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
    worldSpacePosition.xyz /= worldSpacePosition.w;
    return worldSpacePosition.xyz;
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    if (depthTexel.r == 1.0 || dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        discard;
        return;
    }

    vec4 texel = textureLod(inputTexture, vUv, 0.0);

    vec3 normal = texel.rgb;
    float occlusion = texel.a;
    float centerOcclusion = texel.a;

    float depth = depthTexel.x;
    vec3 worldPos = getWorldPos(depth, vUv);

    float count = 1.0;

    for (int i = 0; i < samples; i++) {
        vec2 offset = poissonDisk[i];
        vec4 neighborTexel = textureLod(inputTexture, vUv + offset, 0.0);

        vec3 neighborNormal = neighborTexel.rgb;
        float neighborOcclusion = neighborTexel.a;

        float sampleDepth = textureLod(depthTexture, vUv + offset, 0.0).x;

        vec3 worldPosSample = getWorldPos(sampleDepth, vUv + offset);
        float tangentPlaneDist = abs(dot(worldPos - worldPosSample, normal));

        float normalDiff = dot(normal, neighborNormal);
        float normalSimilarity = pow(max(normalDiff, 0.), normalPhi);

        float rangeCheck = exp(-1.0 * tangentPlaneDist) * max(normalDiff, 0.5 - 0.5 * abs(neighborOcclusion - centerOcclusion));
        float depthSimilarity = rangeCheck / depthPhi;

        float w = depthSimilarity * normalSimilarity;

        occlusion += w * neighborOcclusion;
        count += w;
    }

    if (count > EPSILON) {
        occlusion /= count;
    } else {
        occlusion = centerOcclusion;
    }

    gl_FragColor = vec4(normal, occlusion);
}