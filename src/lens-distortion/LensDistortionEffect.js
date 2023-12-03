import { Effect } from "postprocessing"
import { RepeatWrapping, TextureLoader, Vector2 } from "three"
// import chessboard from "./chessboard.png"

const fragmentShader = /* glsl */ `
    uniform sampler2D inputTexture;
    // uniform sampler2D chessboardTexture;
    uniform vec2 resolution;

    uniform float alphax;
    uniform float alphay;
    uniform float aberration;

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        // source: https://marcodiiga.github.io/radial-lens-undistortion-filtering
        float x = (2.0 * vUv.x - 1.0) / 1.0;
        float y = (2.0 * vUv.y - 1.0) / 1.0;
        
        // Calculate l2 norm
        float r = x*x + y*y;
        
        // Calculate the deflated or inflated new coordinate (reverse transform)
        float x3 = x / (1.0 - alphax * r);
        float y3 = y / (1.0 - alphay * r); 
        float x2 = x / (1.0 - alphax * (x3 * x3 + y3 * y3));
        float y2 = y / (1.0 - alphay * (x3 * x3 + y3 * y3));

        // De-normalize to the original range
        float i2 = (x2 + 1.0) * 1.0 / 2.0;
        float j2 = (y2 + 1.0) * 1.0 / 2.0;

        vec2 duv = vec2(i2, j2);

        // source: https://stackoverflow.com/questions/9841863/reflection-refraction-with-chromatic-aberration-eye-correction
        vec2 rOffset = vec2(1.0 / resolution.x, 0.0);
        vec2 gOffset = vec2(0.0, 1.0 / resolution.y);
        vec2 bOffset = vec2(1.0 / resolution.x, 1.0 / resolution.y);

        vec4 rValue = texture2D(inputTexture, duv - aberration * rOffset);  
        vec4 gValue = texture2D(inputTexture, duv - aberration * gOffset);
        vec4 bValue = texture2D(inputTexture, duv - aberration * bOffset); 

        outputColor = vec4(rValue.r, gValue.g, bValue.b, 1.0);
    }
`
export class LensDistortionEffect extends Effect {
	constructor({ alphax = -0.05, alphay = -0.05, aberration = 1 } = {}) {
		// const chessboardTexture = new TextureLoader().load(chessboard)
		// chessboardTexture.wrapS = chessboardTexture.wrapT = RepeatWrapping

		super("LensDistortionEffect", fragmentShader, {
			uniforms: new Map([
				["inputTexture", { value: null }],
				// ["chessboardTexture", { value: chessboardTexture }],
				["resolution", { value: new Vector2() }],
				["alphax", { value: alphax }],
				["alphay", { value: alphay }],
				["aberration", { value: aberration }]
			])
		})
	}

	update(renderer, inputBuffer) {
		this.uniforms.get("inputTexture").value = inputBuffer.texture
		this.uniforms.get("resolution").value.set(inputBuffer.width, inputBuffer.height)
	}

	setAlphaX(value) {
		this.uniforms.get("alphax").value = value
	}

	setAlphaY(value) {
		this.uniforms.get("alphay").value = value
	}
}
