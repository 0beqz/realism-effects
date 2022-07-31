import { Pass } from "postprocessing"
import { Color, FrontSide, HalfFloatType, LinearFilter, ShaderMaterial, UniformsUtils, WebGLRenderTarget } from "three"
import { VelocityShader } from "../shader/VelocityShader.js"

const backgroundcColor = new Color(0xffffff)

export class VelocityPass extends Pass {
	#cachedMaterials = new WeakMap()

	constructor(scene, camera) {
		super("VelocityPass")

		this._scene = scene
		this._camera = camera

		this.renderTarget = new WebGLRenderTarget(
			typeof window !== "undefined" ? window.innerWidth : 2000,
			typeof window !== "undefined" ? window.innerHeight : 1000,
			{
				minFilter: LinearFilter,
				magFilter: LinearFilter,
				type: HalfFloatType
			}
		)
	}

	#setVelocityMaterialInScene() {
		this._scene.traverse(c => {
			if (c.material) {
				const originalMaterial = c.material

				let [cachedOriginalMaterial, velocityMaterial] = this.#cachedMaterials.get(c) || []

				if (!this.#cachedMaterials.has(c) || originalMaterial !== cachedOriginalMaterial) {
					velocityMaterial = new ShaderMaterial({
						uniforms: UniformsUtils.clone(VelocityShader.uniforms),
						vertexShader: VelocityShader.vertexShader,
						fragmentShader: VelocityShader.fragmentShader,
						side: FrontSide
					})

					this.#cachedMaterials.set(c, [originalMaterial, velocityMaterial])
				}

				velocityMaterial.uniforms.velocityMatrix.value.multiplyMatrices(
					this._camera.projectionMatrix,
					c.modelViewMatrix
				)

				velocityMaterial.wireframe = originalMaterial.wireframe

				c.material = velocityMaterial
			}
		})
	}

	#unsetVelocityMaterialInScene() {
		this._scene.traverse(c => {
			if (c.material) {
				c.material.uniforms.prevVelocityMatrix.value.multiplyMatrices(this._camera.projectionMatrix, c.modelViewMatrix)

				const [originalMaterial] = this.#cachedMaterials.get(c)

				c.material = originalMaterial
			}
		})
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	render(renderer) {
		this.#setVelocityMaterialInScene()

		renderer.setRenderTarget(this.renderTarget)
		renderer.clear()
		const { background } = this._scene
		this._scene.background = backgroundcColor
		renderer.render(this._scene, this._camera)
		this._scene.background = background

		this.#unsetVelocityMaterialInScene()
	}
}
