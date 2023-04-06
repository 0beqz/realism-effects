varying vec2 vUv;

uniform sampler2D depthTexture;
uniform vec3 color;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 inverseProjectionMatrix;
uniform mat4 projectionViewMatrix;
uniform mat4 cameraMatrixWorld;
uniform int frame;

uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform vec2 texSize;

uniform float aoDistance;
uniform float distancePower;
uniform float bias;
uniform float thickness;
uniform float power;

#include <packing>
// HBAO Utils
#include <hbao_utils>

float getOcclusion(const vec3 worldPos, const vec3 worldNormal, const float depth, const int seed) {
    float occlusion = 0.0;

    vec4 blueNoise = sampleBlueNoise(seed, blueNoiseRepeat, texSize);

    // vec3 sampleWorldDir = cosineSampleHemisphere(worldNormal, blueNoise.rg);
    vec3 sampleWorldDir = sampleHemisphere(worldNormal, blueNoise.rg);
    vec3 sampleWorldPos = worldPos + aoDistance * pow(blueNoise.b, distancePower) * sampleWorldDir;

    // Project the sample position to screen space
    vec4 sampleUv = projectionViewMatrix * vec4(sampleWorldPos, 1.);
    sampleUv.xy /= sampleUv.w;
    sampleUv.xy = sampleUv.xy * 0.5 + 0.5;

    // Get the depth of the sample position
    float sampleUnpackedDepth = textureLod(depthTexture, sampleUv.xy, 0.0).r;
    float sampleDepth = -getViewZ(sampleUnpackedDepth);

    // Compute the horizon line
    float deltaDepth = depth - sampleDepth;

    if (deltaDepth < thickness) {
        float horizon = sampleDepth + deltaDepth * bias;

        float occlusionSample = max(0.0, (horizon - depth));
        occlusion += occlusionSample;
    }

    return occlusion;
}

void main() {
    float unpackedDepth = textureLod(depthTexture, vUv, 0.0).r;

    // filter out background
    if (unpackedDepth > 0.9999) {
        discard;
        return;
    }

    float depth = -getViewZ(unpackedDepth);

    vec3 worldPos = getWorldPos(unpackedDepth, vUv);
    vec3 worldNormal = computeNormal(vUv, unpackedDepth);

    float occlusion = 0.0;

    for (int i = 0; i < spp; i++) {
        occlusion += getOcclusion(worldPos, worldNormal, depth, frame + i);
    }

    occlusion /= float(spp);

    float ao = pow(1. - occlusion, power);

    vec3 aoColor = mix(color, vec3(1.), ao);

    gl_FragColor = vec4(aoColor, 1.);
}
