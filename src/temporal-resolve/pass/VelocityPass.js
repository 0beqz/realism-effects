import { Pass } from "postprocessing"
import {
	Color,
	DataTexture,
	FloatType,
	FrontSide,
	HalfFloatType,
	NearestFilter,
	RGBAFormat,
	ShaderMaterial,
	UniformsUtils,
	WebGLRenderTarget
} from "three"
import { VelocityShader } from "../shader/VelocityShader.js"

const backgroundColor = new Color().setRGB(0, 0, 1)

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
				minFilter: NearestFilter,
				magFilter: NearestFilter,
				type: HalfFloatType
			}
		)
	}

	#setVelocityMaterialInScene() {
		this._scene.traverse(c => {
			if (c.material) {
				const originalMaterial = c.material

				let [cachedOriginalMaterial, velocityMaterial] = this.#cachedMaterials.get(c) || []

				if (originalMaterial !== cachedOriginalMaterial) {
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

				if (c.skeleton) {
					velocityMaterial.defines.USE_SKINNING = ""
					velocityMaterial.defines.BONE_TEXTURE = ""

					velocityMaterial.uniforms.boneTexture.value = c.skeleton.boneTexture
				}

				c.material = velocityMaterial
			}
		})
	}

	#saveBoneTexture(object) {
		let boneTexture = object.material.uniforms.prevBoneTexture.value

		if (boneTexture && boneTexture.image.width === object.skeleton.boneTexture.width) {
			boneTexture = object.material.uniforms.prevBoneTexture.value
			boneTexture.image.data.set(object.skeleton.boneTexture.image.data)
		} else {
			if (boneTexture) boneTexture.dispose()

			const boneMatrices = object.skeleton.boneTexture.image.data.slice()
			const size = object.skeleton.boneTexture.image.width

			boneTexture = new DataTexture(boneMatrices, size, size, RGBAFormat, FloatType)
			object.material.uniforms.prevBoneTexture.value = boneTexture

			boneTexture.needsUpdate = true
		}
	}

	#unsetVelocityMaterialInScene() {
		this._scene.traverse(c => {
			if (c.material) {
				c.material.uniforms.prevVelocityMatrix.value.multiplyMatrices(this._camera.projectionMatrix, c.modelViewMatrix)

				if (c.skeleton && c.skeleton.boneTexture) this.#saveBoneTexture(c)

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

		const { background } = this._scene

		this._scene.background = backgroundColor
		renderer.render(this._scene, this._camera)
		this._scene.background = background

		this.#unsetVelocityMaterialInScene()
	}
}
