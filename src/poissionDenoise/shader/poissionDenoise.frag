varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform vec2 resolution;
uniform float radius;
uniform float depthPhi;
uniform float normalPhi;

#include <common>
#include <sampleBlueNoise>

#define NUM_SAMPLES 16
#define NUM_RINGS   11
vec2 poissonDisk[NUM_SAMPLES];

vec3 getWorldPos(float depth, vec2 coord) {
    float z = depth * 2.0 - 1.0;
    vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

    // Perspective division
    vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
    worldSpacePosition.xyz /= worldSpacePosition.w;
    return worldSpacePosition.xyz;
}

void initPoissonSamples() {
    float ANGLE_STEP = PI2 * float(NUM_RINGS) / float(NUM_SAMPLES);
    float INV_NUM_SAMPLES = 1.0 / float(NUM_SAMPLES);

    // jsfiddle that shows sample pattern: https://jsfiddle.net/a16ff1p7/
    float angle = sampleBlueNoise(blueNoiseTexture, 0, blueNoiseRepeat, resolution).x * PI2;

    float radius = INV_NUM_SAMPLES;
    float radiusStep = radius;

    for (int i = 0; i < NUM_SAMPLES; i++) {
        poissonDisk[i] = vec2(cos(angle), sin(angle));
        radius += radiusStep;
        angle += ANGLE_STEP;
    }
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    if (depthTexel.r > 0.9999 || dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        discard;
        return;
    }

    initPoissonSamples();

    vec2 texelSize = vec2(1.0 / resolution.x, 1.0 / resolution.y);

    vec4 texel = textureLod(inputTexture, vUv, 0.0);

    vec3 normal = texel.rgb;
    float occlusion = texel.a;
    float baseOcc = texel.a;

    float depth = depthTexel.x;
    vec3 worldPos = getWorldPos(depth, vUv);

    vec2 texelSizeRadius = texelSize * radius;
    float count = 1.0;

    for (int i = 0; i < NUM_SAMPLES; i++) {
        vec2 offset = poissonDisk[i] * texelSizeRadius;
        vec4 neighborTexel = textureLod(inputTexture, vUv + offset, 0.0);

        float neighborOcclusion = neighborTexel.a;
        vec3 neighborNormal = neighborTexel.rgb;

        float depth = textureLod(depthTexture, vUv + offset, 0.0).x;

        vec3 worldPosSample = getWorldPos(depth, vUv + offset);
        float tangentPlaneDist = abs(dot(worldPos - worldPosSample, normal));

        float normalDiff = dot(normal, neighborNormal);
        float normalSimilarity = pow(max(normalDiff, 0.), normalPhi);

        float rangeCheck = exp(-1.0 * tangentPlaneDist) * (0.5 + 0.5 * dot(normal, neighborNormal)) * (1.0 - abs(neighborOcclusion - baseOcc));

        float depthSimilarity = max(rangeCheck / depthPhi, 0.);

        occlusion += neighborOcclusion * depthSimilarity * normalSimilarity;
        count += depthSimilarity * normalSimilarity;
    }

    if (count > EPSILON) {
        occlusion /= count;
    } else {
        occlusion = baseOcc;
    }

    gl_FragColor = vec4(normal, occlusion);
}