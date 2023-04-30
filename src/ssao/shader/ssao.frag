varying vec2 vUv;

uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform mat4 projectionViewMatrix;
uniform mat4 cameraMatrixWorld;

uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform vec2 texSize;
uniform mat4 projectionMatrixInverse;

uniform float aoDistance;
uniform float distancePower;
uniform int frame;

uniform vec3[spp] samples;
uniform float[spp] samplesR;

#include <common>
#include <packing>
#include <sampleBlueNoise>

// source: https://github.com/N8python/ssao/blob/master/EffectShader.js#L52
vec3 getWorldPos(const float depth, const vec2 coord) {
    float z = depth * 2.0 - 1.0;
    vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

    // Perspective division
    vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
    worldSpacePosition.xyz /= worldSpacePosition.w;

    return worldSpacePosition.xyz;
}

vec3 computeWorldNormal(const float unpackedDepth, const vec2 uv) {
    vec2 uv0 = uv;
    vec2 uv1 = uv + vec2(1., 0.) / texSize;
    vec2 uv2 = uv + vec2(0., 1.) / texSize;

    float depth0 = unpackedDepth;
    float depth1 = textureLod(depthTexture, uv1, 0.0).r;
    float depth2 = textureLod(depthTexture, uv2, 0.0).r;

    vec3 p0 = getWorldPos(depth0, uv0);
    vec3 p1 = getWorldPos(depth1, uv1);
    vec3 p2 = getWorldPos(depth2, uv2);

    vec3 normal = normalize(cross(p2 - p0, p1 - p0));

    return -normal;
}

highp float linearize_depth(highp float d, highp float zNear, highp float zFar) {
    highp float z_n = 2.0 * d - 1.0;
    return 2.0 * zNear * zFar / (zFar + zNear - z_n * (zFar - zNear));
}

void main() {
    float depth = textureLod(depthTexture, vUv, 0.).x;

    // filter out background
    if (depth > 0.9999) {
        discard;
        return;
    }

    vec3 worldPos = getWorldPos(depth, vUv);
    vec3 normal = computeWorldNormal(depth, vUv);

#ifdef animatedNoise
    int seed = frame;
#else
    int seed = 0;
#endif

    vec4 noise = sampleBlueNoise(blueNoiseTexture, seed, blueNoiseRepeat, texSize);

    vec3 randomVec = normalize(noise.rgb * 2.0 - 1.0);
    vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 tbn = mat3(tangent, bitangent, normal);

    float occluded = 0.0;
    float totalWeight = 0.0;

    vec3 samplePos;

    float sppF = float(spp);

    for (float i = 0.0; i < sppF; i++) {
        vec3 sampleDirection = tbn * samples[int(i)];

        // make sure sample direction is in the same hemisphere as the normal
        if (dot(sampleDirection, normal) < 0.0) sampleDirection *= -1.0;

        float moveAmt = samplesR[int(mod(i + noise.a * sppF, sppF))];
        samplePos = worldPos + aoDistance * moveAmt * sampleDirection;

        vec4 offset = projectionViewMatrix * vec4(samplePos, 1.0);
        offset.xyz /= offset.w;
        offset.xyz = offset.xyz * 0.5 + 0.5;

        float sampleDepth = textureLod(depthTexture, offset.xy, 0.0).x;

        float distSample = linearize_depth(sampleDepth, 0.1, 1000.0);
        float distWorld = linearize_depth(offset.z, 0.1, 1000.0);

        float rangeCheck = smoothstep(0.0, 1.0, aoDistance / (aoDistance * abs(distSample - distWorld)));
        rangeCheck = pow(rangeCheck, distancePower);
        float weight = dot(sampleDirection, normal);

        occluded += rangeCheck * weight * (distSample < distWorld ? 1.0 : 0.0);
        totalWeight += weight;
    }

    float occ = clamp(1.0 - occluded / totalWeight, 0.0, 1.0);
    gl_FragColor = vec4(normal, occ);
}