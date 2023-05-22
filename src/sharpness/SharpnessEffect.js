import { Effect } from "postprocessing"
import { Uniform } from "three"

const fragmentShader = /* glsl */ `
uniform sampler2D inputTexture;
uniform float sharpness;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 blurredPixel = texture(inputTexture, uv - 1.0 * texelSize);
    blurredPixel += texture(inputTexture, uv + vec2(0.0, -1.0) * texelSize);
    blurredPixel += texture(inputTexture, uv + vec2(1.0, -1.0) * texelSize);
    blurredPixel += texture(inputTexture, uv + vec2(-1.0, 0.0) * texelSize);
    blurredPixel += inputColor;
    blurredPixel += texture(inputTexture, uv + vec2(1.0, 0.0) * texelSize);
    blurredPixel += texture(inputTexture, uv + vec2(-1.0, 1.0) * texelSize);
    blurredPixel += texture(inputTexture, uv + vec2(0.0, 1.0) * texelSize);
    blurredPixel += texture(inputTexture, uv + 1.0 * texelSize);
    blurredPixel /= 9.0;

    // Calculate the sharpness difference
    vec4 sharpDiff = inputColor - blurredPixel;

    // Apply the sharpness effect by adding the difference scaled by the sharpness value
    vec4 sharpenedPixel = inputColor + sharpDiff * sharpness;

    outputColor = sharpenedPixel;
}
`

const defaultOptions = {
	sharpness: 1
}

export class SharpnessEffect extends Effect {
	constructor(options = defaultOptions) {
		options = { ...defaultOptions, ...options }

		super("SharpnessEffect", fragmentShader, {
			uniforms: new Map([
				["sharpness", new Uniform(options.sharpness)],
				["inputTexture", new Uniform(null)]
			])
		})

		this.setSharpness(options.sharpness)
	}

	setSharpness(sharpness) {
		this.uniforms.get("sharpness").value = sharpness
	}

	update(renderer, inputBuffer) {
		this.uniforms.get("inputTexture").value = inputBuffer.texture
	}
}
