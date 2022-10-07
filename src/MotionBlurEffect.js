import { Effect } from "postprocessing"
import { LinearEncoding, NearestFilter, RepeatWrapping, Uniform, Vector2 } from "three"
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader"

// https://www.nvidia.com/docs/io/8230/gdc2003_openglshadertricks.pdf
// http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html
// reference code: https://github.com/gkjohnson/threejs-sandbox/blob/master/motionBlurPass/src/CompositeShader.js

const fragmentShader = /* glsl */ `
uniform sampler2D inputTexture;
uniform sampler2D velocityTexture;
uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform float intensity;
uniform float jitter;
uniform float time;
uniform float deltaTime;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);

    // skip background
    if(dot(velocity.xyz, velocity.xyz) == 0.0){
        outputColor = inputColor;
        return;
    }

    // unpack velocity [0, 1] -> [-1, 1]
    velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

    velocity.xy *= intensity / (60. * deltaTime);

    vec2 blueNoise = textureLod(blueNoiseTexture, (vUv + time) * blueNoiseRepeat, 0.).rg;
    int numSamples = 8;

    vec3 motionBlurredColor;
    vec3 neighborColor;
    vec2 reprojectedUv;

    vec2 jitterOffset = jitter * velocity.xy * blueNoise / float(numSamples);

    // UVs will be centered around the target pixel (see http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html)
    vec2 startUv = vUv - velocity.xy * 0.5;
    vec2 endUv = vUv + velocity.xy * 0.5 + jitterOffset;

    startUv = max(vec2(0.), startUv);
    endUv = min(vec2(1.), endUv);

    for (int i = 0; i < numSamples; i++) {
        if (i == numSamples) {
            neighborColor = inputColor.rgb;
        } else {
            reprojectedUv = mix(startUv, endUv, float(i) / float(numSamples));
            neighborColor = textureLod(inputTexture, reprojectedUv, 0.0).rgb;
        }

        motionBlurredColor += neighborColor;
    }

    motionBlurredColor /= float(numSamples);

    outputColor = vec4(motionBlurredColor, inputColor.a);
}
`

const defaultOptions = { intensity: 1, jitter: 5 }

export class MotionBlurEffect extends Effect {
	constructor(temporalResolvePass, options = defaultOptions) {
		super("MotionBlurEffect", fragmentShader, {
			type: "MotionBlurMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["velocityTexture", new Uniform(temporalResolvePass.velocityPass.texture)],
				["blueNoiseTexture", new Uniform(null)],
				["blueNoiseRepeat", new Uniform(new Vector2())],
				["intensity", new Uniform(1)],
				["jitter", new Uniform(1)],
				["time", new Uniform(0)],
				["deltaTime", new Uniform(0)]
			])
		})

		options = { ...defaultOptions, ...options }

		for (const key of ["intensity", "jitter"]) {
			Object.defineProperty(this, key, {
				set(value) {
					this.uniforms.get(key).value = value
				},
				get() {
					return this.uniforms.get(key).value
				}
			})

			this[key] = options[key]
		}

		const ktx2Loader = new KTX2Loader()
		ktx2Loader.setTranscoderPath("examples/js/libs/basis/")
		ktx2Loader.detectSupport(window.renderer)
		ktx2Loader.load("texture/blue_noise_rg.ktx2", blueNoiseTexture => {
			// generated using "toktx --target_type RG --t2 blue_noise_rg blue_noise_rg.png"
			blueNoiseTexture.minFilter = NearestFilter
			blueNoiseTexture.magFilter = NearestFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.encoding = LinearEncoding

			this.uniforms.get("blueNoiseTexture").value = blueNoiseTexture
		})
	}

	update(renderer, inputBuffer, deltaTime) {
		this.uniforms.get("inputTexture").value = inputBuffer.texture
		this.uniforms.get("deltaTime").value = Math.max(1 / 1000, deltaTime)

		this.uniforms.get("time").value = (performance.now() % (10 * 60 * 1000)) * 0.01

		const noiseTexture = this.uniforms.get("blueNoiseTexture").value
		if (noiseTexture) {
			const { width, height } = noiseTexture.source.data

			this.uniforms.get("blueNoiseRepeat").value.set(inputBuffer.width / width, inputBuffer.height / height)
		}
	}
}
