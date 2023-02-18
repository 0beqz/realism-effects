import { VelocityDepthNormalPass } from "./VelocityDepthNormalPass "

export class VelocityPass extends VelocityDepthNormalPass {
	constructor(scene, camera) {
		super(scene, camera, false)
	}
}
