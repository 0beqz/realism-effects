varying vec2 vUv;

uniform sampler2D velocityTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform float blend;
uniform float neighborhoodClampIntensity;
uniform bool constantBlend;
uniform bool fullAccumulate;
uniform vec2 invTexSize;
uniform float cameraNear;
uniform float cameraFar;

uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform vec3 cameraPos;
uniform vec3 prevCameraPos;
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
    getDepthAndDilatedUVOffset(depthTexture, vUv, depth, dilatedDepth, depthTexel);

    vec2 dilatedUv = vUv + dilatedUvOffset;

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
    vec3 worldNormal = unpackNormal(textureLod(velocityTexture, dilatedUv, 0.0).b);
#else
    vec3 worldNormal = unpackNormal(velocityTexel.b);
#endif

    vec3 worldPos = screenSpaceToWorldSpace(vUv, depth, cameraMatrixWorld, projectionMatrixInverse);

    vec2 reprojectedUvDiffuse = vec2(-10.0);
    vec2 reprojectedUvSpecular[textureCount];
    bool didReproject;
    bool reprojectHitPoint;

    float flatness = clamp(getFlatness(worldPos, worldNormal) / 0.025, 0., 1.);

    bool isFlat = flatness > 0.5;

#pragma unroll_loop_start
    for (int i = 0; i < textureCount; i++) {
        reprojectHitPoint = reprojectSpecular[i] && inputTexel[i].a > 0.0 && isFlat;

        // specular (hit point reprojection)
        if (reprojectHitPoint) {
            reprojectedUvSpecular[i] = getReprojectedUV(depth, worldPos, worldNormal, inputTexel[i].a);
        } else {
            // init to -1 to signify that reprojection failed
            reprojectedUvSpecular[i] = vec2(-1.0);
        }

        reprojectedUvDiffuse = getReprojectedUV(depth, worldPos, worldNormal, 0.0);

        // choose which UV coordinates to use for reprojecion
        didReproject = reprojectedUvSpecular[i].x >= 0.0 || reprojectedUvDiffuse.x >= 0.0;

        // check if any reprojection was successful
        if (!didReproject) {  // invalid UV
            // reprojection was not successful -> reset to the input texel
            accumulatedTexel[i] = vec4(inputTexel[i].rgb, 0.0);

            vec3 averageColor = inputTexel[i].rgb;
            float count = 1.0;

            for (int x = -1; x <= 1; x++) {
                for (int y = -1; y <= 1; y++) {
                    if (x != 0 || y != 0) {
                        vec2 offset = vec2(x, y) * invTexSize;
                        vec4 texel = textureLod(inputTexture[i], vUv + offset, 0.0);

                        if (luminance(texel.rgb) > 0.0) {
                            transformColor(texel.rgb);
                            averageColor += texel.rgb;
                            count++;
                        }
                    }
                }
            }

            averageColor /= count > 0.0 ? count : 1.;

            accumulatedTexel[i] = vec4(averageColor, 0.);
            inputTexel[i].rgb = averageColor;

#ifdef VISUALIZE_DISOCCLUSIONS
            accumulatedTexel[i] = vec4(vec3(0., 1., 0.), 0.0);
            inputTexel[i].rgb = accumulatedTexel[i].rgb;
#endif

        } else {
            if (reprojectedUvSpecular[i].x >= 0.0) {
                vec4 hitPointTexel = sampleReprojectedTexture(accumulatedTexture[i], reprojectedUvSpecular[i]);
                vec4 diffuseTexel = sampleReprojectedTexture(accumulatedTexture[i], reprojectedUvDiffuse);

                accumulatedTexel[i] = mix(diffuseTexel, hitPointTexel, flatness * flatness);
            } else {
                accumulatedTexel[i] = sampleReprojectedTexture(accumulatedTexture[i], reprojectedUvDiffuse);
            }

#ifdef VISUALIZE_DISOCCLUSIONS
            accumulatedTexel[i].rgb = vec3(0.);
            inputTexel[i].rgb = vec3(0.);
#endif

            transformColor(accumulatedTexel[i].rgb);

            if (textureSampledThisFrame[i]) {
                accumulatedTexel[i].a++;  // add one more frame

                if (neighborhoodClamp[i]) {
                    vec3 clampedColor = accumulatedTexel[i].rgb;

                    int clampRadius = reprojectedUvSpecular[i].x >= 0.0 ? 1 : neighborhoodClampRadius;
                    clampNeighborhood(inputTexture[i], clampedColor, inputTexel[i].rgb, clampRadius);

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

        // outputColor = vec3(flatness);

        gOutput[i] = vec4(outputColor, accumulatedTexel[i].a);

        texIndex++;
    }
#pragma unroll_loop_end

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useTemporalReprojectCustomComposeShader
    temporalReprojectCustomComposeShader
#endif
}