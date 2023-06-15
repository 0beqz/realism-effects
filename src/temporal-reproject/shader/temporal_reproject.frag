varying vec2 vUv;

uniform sampler2D velocityTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastVelocityTexture;

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
    vec2 dilatedUv = vUv;
    getVelocityNormalDepth(dilatedUv, velocity, worldNormal, depth);

    // ! todo: find better solution
    if (textureCount > 1 && depth == 1.0) {
        discard;
        return;
    }

    vec4 inputTexel[textureCount];
    vec4 accumulatedTexel[textureCount];
    bool textureSampledThisFrame[textureCount];

    int cnt = 0;

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

        if (cnt++ == 0) roughness = max(0., inputTexel[i].a);

        texIndex++;
    }
#pragma unroll_loop_end

    texIndex = 0;

    bool didMove = dot(velocity, velocity) > 0.000000001;

    vec3 worldPos = screenSpaceToWorldSpace(dilatedUv, depth, cameraMatrixWorld, projectionMatrixInverse);
    vec3 viewPos = (viewMatrix * vec4(worldPos, 1.0)).xyz;

    vec3 viewDir = normalize(viewPos);
    vec3 viewNormal = (viewMatrix * vec4(worldNormal, 0.0)).xyz;

    // get the angle between the view direction and the normal
    viewAngle = dot(-viewDir, viewNormal);

    vec2 reprojectedUvDiffuse = vec2(-10.0);
    vec2 reprojectedUvSpecular[textureCount];
    bool didReproject;
    bool reprojectHitPoint;
    float rayLength;

    flatness = getFlatness(worldPos, worldNormal);

#pragma unroll_loop_start
    for (int i = 0; i < textureCount; i++) {
        rayLength = inputTexel[i].a;
        reprojectHitPoint = reprojectSpecular[i] && rayLength > 0.0;

        // specular (hit point reprojection)
        if (reprojectHitPoint) {
            reprojectedUvSpecular[i] = getReprojectedUV(depth, worldPos, worldNormal, rayLength);
        } else {
            // init to -1 to signify that reprojection failed
            reprojectedUvSpecular[i] = vec2(-1.0);
        }

        reprojectedUvDiffuse = getReprojectedUV(depth, worldPos, worldNormal, 0.0);

        // choose which UV coordinates to use for reprojecion
        didReproject = reprojectedUvSpecular[i].x >= 0.0 || reprojectedUvDiffuse.x >= 0.0;

        // check if any reprojection was successful
        if (!didReproject || (reprojectHitPoint && reprojectedUvSpecular[i].x < 0.0)) {  // invalid UV
            // reprojection was not successful -> reset to the input texel
            accumulatedTexel[i] = vec4(inputTexel[i].rgb, 0.0);

#ifdef VISUALIZE_DISOCCLUSIONS
            accumulatedTexel[i] = vec4(vec3(0., 1., 0.), 0.0);
            inputTexel[i].rgb = accumulatedTexel[i].rgb;
#endif

        } else {
            if (reprojectHitPoint) {
                accumulatedTexel[i] = sampleReprojectedTexture(accumulatedTexture[i], reprojectedUvSpecular[i]);
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

                    clampNeighborhood(inputTexture[i], clampedColor, inputTexel[i].rgb, neighborhoodClampRadius);

                    accumulatedTexel[i].rgb = mix(accumulatedTexel[i].rgb, clampedColor, 0.);
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
            if (temporalReprojectMix > 0.5) temporalReprojectMix = mix(temporalReprojectMix, 0.5, angleMix);

            accumulatedTexel[i].a = 1. / (1. - temporalReprojectMix) - 1.;
        }

        outputColor = mix(inputTexel[i].rgb, accumulatedTexel[i].rgb, temporalReprojectMix);
        undoColorTransform(outputColor);

        // outputColor = vec3(worldNormal);

        gOutput[i] = vec4(outputColor, accumulatedTexel[i].a);

        texIndex++;
    }
#pragma unroll_loop_end

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useTemporalReprojectCustomComposeShader
    temporalReprojectCustomComposeShader
#endif
}