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

float getOcclusion(const vec3 cameraPosition, const vec3 worldPos, const vec3 worldNormal, const float depth, const int seed, inout float totalWeight) {
    vec4 blueNoise = sampleBlueNoise(blueNoiseTexture, seed, blueNoiseRepeat, texSize);

    vec3 sampleWorldDir = cosineSampleHemisphere(worldNormal, blueNoise.rg);

    vec3 sampleWorldPos = worldPos + aoDistance * pow(blueNoise.b, distancePower + 1.0) * sampleWorldDir;

    // Project the sample position to screen space
    vec4 sampleUv = projectionViewMatrix * vec4(sampleWorldPos, 1.);
    sampleUv.xy /= sampleUv.w;
    sampleUv.xy = sampleUv.xy * 0.5 + 0.5;

    // Get the depth of the sample position
    float sampleDepth = textureLod(depthTexture, sampleUv.xy, 0.0).r;

    // Compute the horizon line
    float deltaDepth = depth - sampleDepth;

    // distance based bias
    float d = distance(sampleWorldPos, cameraPosition);
    deltaDepth *= 0.001 * d * d;

    float th = thickness * 0.01;

    float theta = dot(worldNormal, sampleWorldDir);
    totalWeight += theta;

    if (deltaDepth < th) {
        float horizon = sampleDepth + deltaDepth * bias * 1000.;

        float occlusion = max(0.0, horizon - depth) * theta;

        float m = max(0., 1. - deltaDepth / th);
        occlusion = 10. * occlusion * m / d;

        occlusion = sqrt(occlusion);
        return occlusion;
    }

    return 0.;
}

void main() {
    float depth = textureLod(depthTexture, vUv, 0.0).r;

    // filter out background
    if (depth == 1.0) {
        discard;
        return;
    }

    vec4 cameraPosition = cameraMatrixWorld * vec4(0.0, 0.0, 0.0, 1.0);

    vec3 worldPos = getWorldPos(depth, vUv);
    vec3 worldNormal = getWorldNormal(worldPos, vUv);

    float ao = 0.0, totalWeight = 0.0;

    for (int i = 0; i < spp; i++) {
        int seed = i;
#ifdef animatedNoise
        seed += frame;
#endif

        float occlusion = getOcclusion(cameraPosition.xyz, worldPos, worldNormal, depth, seed, totalWeight);
        ao += occlusion;
    }

    if (totalWeight > 0.) ao /= totalWeight;

    // clamp ao to [0, 1]
    ao = clamp(1. - ao, 0., 1.);

    gl_FragColor = vec4(worldNormal, ao);
}