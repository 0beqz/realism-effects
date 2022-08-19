// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;
uniform sampler2D velocityTexture;
uniform sampler2D lastVelocityTexture;

uniform float blend;
uniform float correction;
uniform float exponent;
uniform float samples;
uniform vec2 invTexSize;

uniform mat4 curInverseProjectionMatrix;
uniform mat4 curCameraMatrixWorld;
uniform mat4 prevInverseProjectionMatrix;
uniform mat4 prevCameraMatrixWorld;

varying vec2 vUv;

#define FLOAT_EPSILON           0.00001
#define FLOAT_ONE_MINUS_EPSILON 0.99999

vec3 transformexponent;
vec3 undoColorTransformExponent;

// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
vec3 transformColor(vec3 color) {
    if (exponent == 1.0) return color;

#ifdef logTransform
    return log(max(color, vec3(FLOAT_EPSILON)));
#else
    return pow(abs(color), transformexponent);
#endif
}

vec3 undoColorTransform(vec3 color) {
    if (exponent == 1.0) return color;

#ifdef logTransform
    return exp(color);
#else
    return max(pow(abs(color), undoColorTransformExponent), vec3(0.0));
#endif
}

void main() {
    if (exponent != 1.0) {
        transformexponent = vec3(1.0 / exponent);
        undoColorTransformExponent = vec3(exponent);
    }

    vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);
    vec4 accumulatedTexel;

    vec3 inputColor = transformColor(inputTexel.rgb);
    vec3 accumulatedColor;

    float alpha = inputTexel.a;

    // REPROJECT_START

    float velocityDisocclusion;
    bool didReproject = false;

#ifdef boxBlur
    vec3 boxBlurredColor = inputTexel.rgb;
#endif

    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);
    float depth = velocity.b;
    bool isMoving = alpha < 1.0 || dot(velocity.xy, velocity.xy) > 0.0;

    if (true) {
        vec3 minNeighborColor = inputColor;
        vec3 maxNeighborColor = inputColor;

        vec3 col;
        vec2 neighborUv;

        vec2 reprojectedUv = vUv - velocity.xy;
        vec4 lastVelocity = textureLod(lastVelocityTexture, reprojectedUv, 0.0);

        float closestDepth = depth;
        float lastClosestDepth = lastVelocity.b;
        float neighborDepth;
        float lastNeighborDepth;
        float colorCount = 1.0;

        for (int x = -correctionRadius; x <= correctionRadius; x++) {
            for (int y = -correctionRadius; y <= correctionRadius; y++) {
                if (x != 0 || y != 0) {
                    neighborUv = vUv + vec2(x, y) * invTexSize;

                    if (neighborUv.x >= 0.0 && neighborUv.x <= 1.0 && neighborUv.y >= 0.0 && neighborUv.y <= 1.0) {
                        vec4 neigborVelocity = textureLod(velocityTexture, neighborUv, 0.0);
                        neighborDepth = neigborVelocity.b;

                        int absX = abs(x);
                        int absY = abs(y);

#ifdef dilation
                        if (absX <= 1 && absY <= 1) {
                            if (neighborDepth > closestDepth) {
                                velocity = neigborVelocity;
                                closestDepth = neighborDepth;
                            }

                            vec4 lastNeighborVelocity = textureLod(velocityTexture, vUv + vec2(x, y) * invTexSize, 0.0);
                            lastNeighborDepth = lastNeighborVelocity.b;

                            if (lastNeighborDepth > lastClosestDepth) {
                                lastVelocity = lastNeighborVelocity;
                                lastClosestDepth = lastNeighborDepth;
                            }
                        }
#endif

                        // the neighbor pixel is invalid if it's too far away from this pixel
                        if (abs(depth - neighborDepth) < maxNeighborDepthDifference) {
                            col = textureLod(inputTexture, neighborUv, 0.0).xyz;
                            col = transformColor(col);

#ifdef boxBlur
                            if (absX <= 2 && absY <= 2) {
                                boxBlurredColor += col;
                                colorCount += 1.0;
                            }
#endif

                            minNeighborColor = min(col, minNeighborColor);
                            maxNeighborColor = max(col, maxNeighborColor);
                        }
                    }
                }
            }
        }

        // velocity
        float velocityLength = length(lastVelocity.xy - velocity.xy);

        // using the velocity to find disocclusions
        velocityDisocclusion = (velocityLength - 0.000005) * 10.0;
        velocityDisocclusion *= velocityDisocclusion;

        reprojectedUv = vUv - velocity.xy;

        // box blur

#ifdef boxBlur
        // box blur
        boxBlurredColor = transformColor(boxBlurredColor);
#endif

        // the reprojected UV coordinates are inside the view
        if (reprojectedUv.x >= 0.0 && reprojectedUv.x <= 1.0 && reprojectedUv.y >= 0.0 && reprojectedUv.y <= 1.0) {
            accumulatedTexel = textureLod(accumulatedTexture, reprojectedUv, 0.0);
            alpha = min(alpha, accumulatedTexel.a);
            accumulatedColor = transformColor(accumulatedTexel.rgb);

            if (alpha < 1.0) {
                vec3 clampedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);

                accumulatedColor = mix(accumulatedColor, clampedColor, correction);
            }

            vec3 clampedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);

            accumulatedColor = mix(accumulatedColor, clampedColor, correction);

            didReproject = true;
        } else {
            // reprojected UV coordinates are outside of screen
#ifdef boxBlur
            accumulatedColor = boxBlurredColor;
#else
            accumulatedColor = inputColor;
#endif
        }

        // this texel is marked as constantly moving (e.g. from a VideoTexture), so treat it accordingly
        if (velocity.r > FLOAT_ONE_MINUS_EPSILON && velocity.g > FLOAT_ONE_MINUS_EPSILON) {
            alpha = 0.0;
            velocityDisocclusion = 1.0;
        }
    } else {
        // there was no need to do neighborhood clamping, let's re-use the accumulated texel from the same UV coordinate
        accumulatedColor = transformColor(textureLod(accumulatedTexture, vUv, 0.0).rgb);
    }

    // REPROJECT_END

    vec3 outputColor = inputColor;

    // the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#include <custom_compose_shader>

    gl_FragColor = vec4(undoColorTransform(outputColor), alpha);
}