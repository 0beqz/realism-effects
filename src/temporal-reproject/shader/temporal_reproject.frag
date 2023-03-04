varying vec2 vUv;

uniform sampler2D velocityTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform sampler2D normalTexture;
uniform sampler2D lastNormalTexture;

uniform float blend;
uniform bool constantBlend;
uniform bool fullAccumulate;
uniform vec2 invTexSize;

uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform vec3 cameraPos;
uniform mat4 prevViewMatrix;
uniform mat4 prevCameraMatrixWorld;
uniform mat4 prevProjectionMatrix;
uniform mat4 prevProjectionMatrixInverse;

uniform bool reset;
uniform float delta;

#define EPSILON 0.00001

#include <packing>
#include <reproject>

void main() {
    vec4 depthTexel;
    float depth;

    getDepthAndDilatedUVOffset(depthTexture, vUv, depth, dilatedDepth, depthTexel);
    vec2 dilatedUv = vUv + dilatedUvOffset;

    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.0) {
#ifdef neighborhoodClamping
    #pragma unroll_loop_start
        for (int i = 0; i < textureCount; i++) {
            gOutput[i] = textureLod(inputTexture[i], vUv, 0.0);
        }
    #pragma unroll_loop_end
#else
        discard;
#endif
        return;
    }

    vec4 inputTexel[textureCount];
    vec4 accumulatedTexel[textureCount];

#pragma unroll_loop_start
    for (int i = 0; i < textureCount; i++) {
        inputTexel[i] = textureLod(inputTexture[i], vUv, 0.0);
        transformColor(inputTexel[i].rgb);
    }
#pragma unroll_loop_end

    vec4 normalTexel = textureLod(normalTexture, dilatedUv, 0.);
    vec3 worldNormal = unpackRGBToNormal(normalTexel.rgb);
    worldNormal = normalize((vec4(worldNormal, 1.) * viewMatrix).xyz);

    // worldPos is not dilated by default
    vec3 worldPos = screenSpaceToWorldSpace(vUv, dilatedDepth, cameraMatrixWorld, projectionMatrixInverse);

    vec2 reprojectedUvDiffuse = vec2(-10.0);
    vec2 reprojectedUvSpecular[textureCount];

    vec2 reprojectedUv;
    bool reprojectHitPoint;

    vec3 clampedColor;

#pragma unroll_loop_start
    for (int i = 0; i < textureCount; i++) {
        reprojectHitPoint = reprojectSpecular[i] && inputTexel[i].a > 0.0;

        // specular (hit point reprojection)
        if (reprojectHitPoint) {
            reprojectedUvSpecular[i] = getReprojectedUV(vUv, neighborhoodClamping[i], depth, worldPos, worldNormal, inputTexel[i].a);
        } else {
            // init to -1 to signify that reprojection failed
            reprojectedUvSpecular[i] = vec2(-1.0);
        }

        // diffuse (reprojection using velocity)
        if (reprojectedUvDiffuse.x == -10.0 && reprojectedUvSpecular[i].x < 0.0) {
            reprojectedUvDiffuse = getReprojectedUV(vUv, neighborhoodClamping[i], depth, worldPos, worldNormal, 0.0);
        }

        // choose which UV coordinates to use for reprojecion
        reprojectedUv = reprojectedUvSpecular[i].x >= 0.0 ? reprojectedUvSpecular[i] : reprojectedUvDiffuse;

        // check if any reprojection was successful
        if (reprojectedUv.x < 0.0) {  // invalid UV
            // reprojection was not successful -> reset to the input texel
            accumulatedTexel[i] = vec4(inputTexel[i].rgb, 1.0);
        } else {
            // reprojection was successful -> accumulate
            accumulatedTexel[i] = sampleReprojectedTexture(accumulatedTexture[i], reprojectedUv, catmullRomSampling[i]);
            transformColor(accumulatedTexel[i].rgb);

            if (dot(inputTexel[i].rgb, inputTexel[i].rgb) == 0.0) {
                inputTexel[i].rgb = accumulatedTexel[i].rgb;
            } else {
                accumulatedTexel[i].a++;  // add one more frame
            }

            if (neighborhoodClamping[i]) {
                clampedColor = accumulatedTexel[i].rgb;
                clampNeighborhood(inputTexture[i], clampedColor, inputTexel[i].rgb);
                accumulatedTexel[i].rgb = clampedColor;
            }
        }
    }
#pragma unroll_loop_end

    vec2 deltaUv = vUv - reprojectedUv;
    bool didMove = dot(deltaUv, deltaUv) >= 0.0000000001;
    float maxValue = (fullAccumulate && !didMove) ? 1.0 : blend;

    vec3 outputColor;
    float temporalReprojectMix;

    float m = 1. - delta / (1. / 60.);
    float fpsAdjustedBlend = blend + max(0., (1. - blend) * m);

#pragma unroll_loop_start
    for (int i = 0; i < textureCount; i++) {
        temporalReprojectMix = fpsAdjustedBlend;

        if (reset) accumulatedTexel[i].a = 0.0;

        if (!constantBlend) temporalReprojectMix = min(1. - 1. / (accumulatedTexel[i].a + 1.0), maxValue);

        outputColor = mix(inputTexel[i].rgb, accumulatedTexel[i].rgb, temporalReprojectMix);
        undoColorTransform(outputColor);

        gOutput[i] = vec4(outputColor, accumulatedTexel[i].a);
    }
#pragma unroll_loop_end

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useCustomComposeShader
    customComposeShader
#endif
}