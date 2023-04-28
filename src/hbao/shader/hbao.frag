varying vec2 vUv;

uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform vec3 color;
uniform float cameraNear;
uniform float time;
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

#define SAMPLES  16
#define FSAMPLES 16.0

const float radius = 5.0;

uniform vec3[SAMPLES] samples;
uniform float[SAMPLES] samplesR;

#include <common>
#include <packing>
// HBAO Utils
#include <hbao_utils>

highp float linearize_depth(highp float d, highp float zNear, highp float zFar) {
    highp float z_n = 2.0 * d - 1.0;
    return 2.0 * zNear * zFar / (zFar + zNear - z_n * (zFar - zNear));
}

void main() {
    float depth = texture2D(depthTexture, vUv).x;
    if (depth == 1.0) {
        gl_FragColor = vec4(vec3(1.0), 1.0);
        return;
    }

    vec3 worldPos = getWorldPos(depth, vUv);
    vec3 normal = computeNormal(worldPos, vUv);

    normal = unpackRGBToNormal(texture2D(normalTexture, vUv).rgb);

    // convert normal to world-space
    normal = normalize((cameraMatrixWorld * vec4(normal, 0.0)).xyz);

    vec4 noise = sampleBlueNoise(blueNoiseTexture, frame, blueNoiseRepeat, texSize);
    vec3 randomVec = normalize(noise.rgb * 2.0 - 1.0);
    vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 tbn = mat3(tangent, bitangent, normal);
    float occluded = 0.0;
    float totalWeight = 0.0;

    vec3 samplePos;

    for (float i = 0.0; i < FSAMPLES; i++) {
        vec3 sampleDirection = tbn * samples[int(i)];

        float moveAmt = samplesR[int(mod(i + noise.a * FSAMPLES, FSAMPLES))];
        samplePos = worldPos + radius * moveAmt * sampleDirection;

        vec4 offset = projectionViewMatrix * vec4(samplePos, 1.0);
        offset.xyz /= offset.w;
        offset.xyz = offset.xyz * 0.5 + 0.5;

        float sampleDepth = textureLod(depthTexture, offset.xy, 0.0).x;

        float distSample = linearize_depth(sampleDepth, 0.1, 1000.0);
        float distWorld = linearize_depth(offset.z, 0.1, 1000.0);
        float rangeCheck = smoothstep(0.0, 1.0, radius / (radius * abs(distSample - distWorld)));
        float weight = dot(sampleDirection, normal);

        occluded += rangeCheck * weight * (distSample < distWorld ? 1.0 : 0.0);
        totalWeight += weight;
    }

    float occ = clamp(1.0 - occluded / totalWeight, 0.0, 1.0);
    gl_FragColor = vec4(1. - occ);
}