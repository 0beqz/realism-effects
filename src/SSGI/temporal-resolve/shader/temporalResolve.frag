// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;

uniform sampler2D velocityTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform float blend;
uniform float correction;
uniform float samples;
uniform vec2 invTexSize;

varying vec2 vUv;

#define FLOAT_EPSILON           0.00001
#define FLOAT_ONE_MINUS_EPSILON 0.9999
#define ALPHA_STEP              0.001

#include <packing>

// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
vec3 transformColor(vec3 color) {
#ifdef logTransform
    return log(max(color, vec3(FLOAT_EPSILON)));
#else
    return color;
#endif
}

vec3 undoColorTransform(vec3 color) {
#ifdef logTransform
    return exp(color);
#else
    return color;
#endif
}

void main() {
    vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);

    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
    float depth = unpackRGBAToDepth(depthTexel);

    vec3 inputColor = transformColor(inputTexel.rgb);
    float alpha = 1.0;

    vec4 accumulatedTexel;
    vec3 accumulatedColor;

    vec2 closestDepthUv = vUv;

#if defined(dilation) || defined(neighborhoodClamping)
    vec3 minNeighborColor = inputColor;
    vec3 maxNeighborColor = inputColor;

    float maxDepth = 1.;

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            if (x != 0 || y != 0) {
                vec2 offset = vec2(x, y) * invTexSize;
                vec2 neighborUv = vUv + offset;

                if (all(greaterThanEqual(neighborUv, vec2(0.))) && all(lessThanEqual(neighborUv, vec2(1.)))) {
    #ifdef dilation
                    if (x >= 0 && y >= 0 && x <= 1 && y <= 1) {
                        float neighborDepth = unpackRGBAToDepth(textureLod(depthTexture, neighborUv, 0.0));
                        if (neighborDepth < maxDepth) {
                            maxDepth = neighborDepth;
                            closestDepthUv = vUv + vec2(x, y) * invTexSize;
                        }
                    }
    #endif

    #ifdef neighborhoodClamping
                    vec4 neighborTexel = textureLod(inputTexture, neighborUv, 0.0);

                    vec3 col = transformColor(neighborTexel.rgb);

                    minNeighborColor = min(col, minNeighborColor);
                    maxNeighborColor = max(col, maxNeighborColor);

    #endif
                }
            }
        }
    }

#endif

    // velocity
    vec4 velocity = textureLod(velocityTexture, closestDepthUv, 0.0);
    velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

    if (all(lessThan(abs(velocity.xy), invTexSize * 0.25))) {
        velocity.xy = vec2(0.);
    }

    vec2 reprojectedUv = vUv - velocity.xy;

    float depthDiff = 1.0;

    // the reprojected UV coordinates are inside the view
    if (all(greaterThanEqual(reprojectedUv, vec2(0.))) && all(lessThanEqual(reprojectedUv, vec2(1.)))) {
        float lastDepth = unpackRGBAToDepth(textureLod(lastDepthTexture, reprojectedUv, 0.));

        depthDiff = abs(depth - lastDepth);

        // reproject the last frame if there was no disocclusion
        if (depthDiff < maxNeighborDepthDifference) {
            accumulatedTexel = textureLod(accumulatedTexture, reprojectedUv, 0.0);

            alpha = accumulatedTexel.a;
            alpha = min(alpha, blend);
            accumulatedColor = transformColor(accumulatedTexel.rgb);

            alpha += ALPHA_STEP;

#ifdef neighborhoodClamping
            vec3 clampedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);

            accumulatedColor = mix(accumulatedColor, clampedColor, correction);
#endif
        } else {
            accumulatedColor = inputColor;
            alpha = 0.0;
        }
    } else {
        accumulatedColor = inputColor;
        alpha = 0.0;
    }

    vec3 outputColor = inputColor;

    float pixelSample = alpha / ALPHA_STEP + 1.0;
    float temporalResolveMix = 1. - 1. / pixelSample;
    temporalResolveMix = min(temporalResolveMix, blend);

    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useCustomComposeShader
    customComposeShader
#else
    gl_FragColor = vec4(undoColorTransform(outputColor), alpha);
#endif

    // if (depthDiff > maxNeighborDepthDifference) gl_FragColor = vec4(0., 1., 0., 1.);
}