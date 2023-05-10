varying vec2 vUv;

uniform sampler2D velocityTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform float blend;
uniform float neighborhoodClampIntensity;
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
#pragma unroll_loop_start
    for (int i = 0; i < textureCount; i++) {
        gOutput[i] = vec4(1.0);
    }
#pragma unroll_loop_end

    return;

    getDepthAndDilatedUVOffset(depthTexture, vUv, depth, dilatedDepth, depthTexel);

    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.0) {
#ifdef neighborhoodClamp
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

    vec2 dilatedUv = vUv + dilatedUvOffset;
    edgeStrength = computeEdgeStrength(depth, invTexSize);

    vec4 inputTexel[textureCount];
    vec4 accumulatedTexel[textureCount];
    bool textureSampledThisFrame[textureCount];

#pragma unroll_loop_start
    for (int i = 0; i < textureCount; i++) {
        inputTexel[i] = textureLod(inputTexture[i], vUv, 0.0);

        doColorTransform[i] = luminance(inputTexel[i].rgb) > 0.0;

        textureSampledThisFrame[i] = inputTexel[i].r >= 0.;

        if (textureSampledThisFrame[i]) {
            transformColor(inputTexel[i].rgb);
        } else {
            inputTexel[i].rgb = vec3(0.0);
        }

        texIndex++;
    }
#pragma unroll_loop_end

    texIndex = 0;

    velocityTexel = textureLod(velocityTexture, vUv, 0.0);
    didMove = dot(velocityTexel.xy, velocityTexel.xy) > 0.000000001;

#ifdef dilation
    vec2 octahedronEncodedNormal = textureLod(velocityTexture, dilatedUv, 0.0).ba;
#else
    vec2 octahedronEncodedNormal = velocityTexel.ba;
#endif

    vec3 worldNormal = Decode(octahedronEncodedNormal);
    vec3 worldPos = screenSpaceToWorldSpace(vUv, depth, cameraMatrixWorld, projectionMatrixInverse);

    vec2 reprojectedUvDiffuse = vec2(-10.0);
    vec2 reprojectedUvSpecular[textureCount];
    vec2 reprojectedUv;
    bool reprojectHitPoint;

#pragma unroll_loop_start
    for (int i = 0; i < textureCount; i++) {
        reprojectHitPoint = reprojectSpecular[i] && inputTexel[i].a > 0.0;

        // specular (hit point reprojection)
        if (reprojectHitPoint) {
            reprojectedUvSpecular[i] = getReprojectedUV(depth, worldPos, worldNormal, inputTexel[i].a);
        } else {
            // init to -1 to signify that reprojection failed
            reprojectedUvSpecular[i] = vec2(-1.0);
        }

        // diffuse (reprojection using velocity)
        if (reprojectedUvDiffuse.x == -10.0 && reprojectedUvSpecular[i].x < 0.0) {
            reprojectedUvDiffuse = getReprojectedUV(depth, worldPos, worldNormal, 0.0);
        }

        // choose which UV coordinates to use for reprojecion
        reprojectedUv = reprojectedUvSpecular[i].x >= 0.0 ? reprojectedUvSpecular[i] : reprojectedUvDiffuse;

        // check if any reprojection was successful
        if (reprojectedUv.x < 0.0) {  // invalid UV
            // reprojection was not successful -> reset to the input texel
            accumulatedTexel[i] = vec4(inputTexel[i].rgb, 0.0);
        } else {
            accumulatedTexel[i] = sampleReprojectedTexture(accumulatedTexture[i], reprojectedUv);

            transformColor(accumulatedTexel[i].rgb);

            if (textureSampledThisFrame[i]) {
                accumulatedTexel[i].a++;  // add one more frame

                if (neighborhoodClamp[i]) {
                    vec3 clampedColor = accumulatedTexel[i].rgb;
                    clampNeighborhood(inputTexture[i], clampedColor, inputTexel[i].rgb);

                    accumulatedTexel[i].rgb = mix(accumulatedTexel[i].rgb, clampedColor, neighborhoodClampIntensity);
                }
            } else {
                inputTexel[i].rgb = accumulatedTexel[i].rgb;
            }
        }

        texIndex++;
    }
#pragma unroll_loop_end

    texIndex = 0;

    float m = 1. - delta / (1. / 60.);
    float fpsAdjustedBlend = blend + max(0., (1. - blend) * m);

    float maxValue = (fullAccumulate && !didMove) ? 1.0 : fpsAdjustedBlend;

    vec3 outputColor;
    float temporalReprojectMix;

#pragma unroll_loop_start
    for (int i = 0; i < textureCount; i++) {
        if (constantBlend) {
            temporalReprojectMix = accumulatedTexel[i].a == 0.0 ? 0.0 : fpsAdjustedBlend;
        } else {
            temporalReprojectMix = fpsAdjustedBlend;

            if (reset) accumulatedTexel[i].a = 0.0;

            temporalReprojectMix = min(1. - 1. / (accumulatedTexel[i].a + 1.0), maxValue);
        }

        outputColor = mix(inputTexel[i].rgb, accumulatedTexel[i].rgb, temporalReprojectMix);
        undoColorTransform(outputColor);

        gOutput[i] = vec4(outputColor, accumulatedTexel[i].a);

        texIndex++;
    }
#pragma unroll_loop_end

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useTemporalReprojectCustomComposeShader
    temporalReprojectCustomComposeShader
#endif
}