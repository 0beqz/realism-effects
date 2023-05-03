varying vec2 vUv;

uniform sampler2D depthTexture;

uniform mat4 projectionViewMatrix;
uniform int frame;

uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform vec2 texSize;

uniform float aoDistance;
uniform float distancePower;
uniform float bias;
uniform float thickness;

#include <packing>
// HBAO Utils
#include <hbao_utils>

float getOcclusion(const vec3 cameraPosition, const vec3 worldPos, const vec3 worldNormal, const float depth, const int seed, out vec3 sampleWorldDir) {
    vec4 blueNoise = sampleBlueNoise(blueNoiseTexture, seed, blueNoiseRepeat, texSize);

    sampleWorldDir = cosineSampleHemisphere(worldNormal, blueNoise.rg);

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

    float d = distance(sampleWorldPos, cameraPosition);
    deltaDepth *= 0.001 * d * d;

    if (deltaDepth < thickness) {
        float horizon = sampleDepth + deltaDepth * bias;

        float occlusionSample = max(0.0, horizon - depth);
        float occlusion = occlusionSample * dot(worldNormal, sampleWorldDir);
        return occlusion;
    }

    return 0.;
}

void main() {
    float unpackedDepth = textureLod(depthTexture, vUv, 0.0).r;

    // filter out background
    if (unpackedDepth > 0.9999) {
        discard;
        return;
    }

    vec4 cameraPosition = cameraMatrixWorld * vec4(0.0, 0.0, 0.0, 1.0);

    vec3 worldPos = getWorldPos(unpackedDepth, vUv);
    vec3 worldNormal = getWorldNormal(unpackedDepth, vUv);
    vec3 bentNormal = worldNormal;
    float depth = -getViewZ(unpackedDepth);

    vec3 sampleWorldDir;
    float ao = 0.0;

    for (int i = 0; i < spp; i++) {
        int seed = i;
#ifdef animatedNoise
        seed += frame;
#endif

        float occlusion = getOcclusion(cameraPosition.xyz, worldPos, bentNormal, depth, seed, sampleWorldDir);

        float visibility = 1. - occlusion;
        ao += visibility;

#ifdef bentNormals
        if (visibility >= worldNormalOcclusionVisibility) {
            totalWeight += visibility;
            float w = visibility / totalWeight;

            // slerp towards the sample direction based on the visibility
            bentNormal = slerp(bentNormal, sampleWorldDir, w);
        }
#endif
    }

    ao /= float(spp);

    // clamp ao to [0, 1]
    ao = clamp(ao, 0., 1.);

    gl_FragColor = vec4(worldNormal, ao);
}
