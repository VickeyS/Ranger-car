import SimpleCar from './SimpleCar.js'
import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import Experience from '../Experience.js'

export default class SimpleCarController {
    constructor() {
        this.experience = new Experience()
        this.simpleCar = new SimpleCar() // Get the singleton instance of SimpleCar
        this.maxSteerVal = Math.PI / 6.5  // Tighter steering for better control
        // Positive drive force should map to "forward" with ArrowUp/W
        this.maxForce = 65

        // Get Nintendo colors from the car model
        this.nintendoColors = this.simpleCar.simpleCarModel.getNintendoColors();

        // Jump counter
        this.jumpCount = 0
        this.maxJumps = 2
        this.isGrounded = true
        this.groundCheckInterval = null

        // Control feel
        this.steerSensitivity = 0.06 // More responsive steering
        this.jumpImpulse = 45 // Less bouncy
        this.boostForce = 100 // Smoother boost

        this.setSteering()
        this.setupGroundDetection()
        this.setupTouchControls()

        // Controller smoothing state
        this.targetForce = 0
        this.currentForce = 0
        this.targetSteer = 0
        this.currentSteer = 0

        // Start RAF update loop to smoothly apply forces
        this.updateLoop = this.updateLoop.bind(this)
        requestAnimationFrame(this.updateLoop)
    }

    updateLoop() {
        if (!this.paused && this.simpleCar && this.simpleCar.vehicle) {
            // Smoothly interpolate force and steering
            const lerp = (a, b, t) => a + (b - a) * t
            this.currentForce = lerp(this.currentForce, this.targetForce, 0.08)
            this.currentSteer = lerp(this.currentSteer, this.targetSteer, 0.12)

            // Apply forces to vehicle wheels
            try {
                this.simpleCar.vehicle.setWheelForce(this.currentForce, 0)
                this.simpleCar.vehicle.setWheelForce(this.currentForce, 1)
                // Apply steering to front wheels
                this.simpleCar.vehicle.setSteeringValue(this.currentSteer, 2)
                this.simpleCar.vehicle.setSteeringValue(this.currentSteer, 3)
            } catch (e) {
                // vehicle not ready yet
            }
        }

        requestAnimationFrame(this.updateLoop)
    }

    setupTouchControls() {
        // Map touch buttons to actions (includes design controls)
        const controls = document.querySelectorAll('#mobile-controls .ctl')
        if (!controls || controls.length === 0) return

        // Available designs
        this.designs = ['Kart', 'Cat']
        // Determine current design index from model
        const current = this.simpleCar.simpleCarModel && this.simpleCar.simpleCarModel.currentDesign ? this.simpleCar.simpleCarModel.currentDesign : 'Kart'
        this.currentDesignIndex = Math.max(0, this.designs.indexOf(current))

        const designLabelEl = document.getElementById('design-label')
        if (designLabelEl) designLabelEl.textContent = this.designs[this.currentDesignIndex]

        const setDesignByIndex = (idx) => {
            idx = (idx + this.designs.length) % this.designs.length
            this.currentDesignIndex = idx
            const design = this.designs[idx]
            if (this.simpleCar?.simpleCarModel?.setDesign) {
                this.simpleCar.simpleCarModel.setDesign(design)
            }
            // Re-apply currently selected color so new design matches UI
            const color = this.experience?.gameSettings?.getSettings()?.appearance?.carColor
            if (color && this.simpleCar?.updateColor) {
                this.simpleCar.updateColor(color)
            } else if (color && this.simpleCar?.simpleCarModel?.setColor) {
                this.simpleCar.simpleCarModel.setColor(color)
            }
            if (designLabelEl) designLabelEl.textContent = design
        }

        const actionDown = (action) => {
            switch (action) {
                case 'up':
                    this.targetForce = this.maxForce
                    // Start engine audio on user throttle
                    if (this.simpleCar && this.simpleCar.startEngine) this.simpleCar.startEngine()
                    break
                case 'down':
                    this.targetForce = -this.maxForce * 0.6
                    if (this.simpleCar && this.simpleCar.startEngine) this.simpleCar.startEngine()
                    break
                case 'left':
                    this.targetSteer = this.maxSteerVal
                    break
                case 'right':
                    this.targetSteer = -this.maxSteerVal
                    break
                case 'jump':
                    this.jumpCar()
                    break
                case 'boost':
                    this.turboBoost()
                    break
                case 'color':
                    this.changeCarColor()
                    break
                case 'design-next':
                    setDesignByIndex(this.currentDesignIndex + 1)
                    break
                case 'design-prev':
                    setDesignByIndex(this.currentDesignIndex - 1)
                    break
            }
        }

        const actionUp = (action) => {
            switch (action) {
                case 'up':
                case 'down':
                    this.targetForce = 0
                    break
                case 'left':
                case 'right':
                    this.targetSteer = 0
                    break
            }
        }

        controls.forEach((btn) => {
            const action = btn.dataset.action

            // touch events
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); actionDown(action) }, { passive: false })
            btn.addEventListener('touchend', (e) => { e.preventDefault(); actionUp(action) })

            // mouse fallback
            btn.addEventListener('mousedown', (e) => { e.preventDefault(); actionDown(action) })
            btn.addEventListener('mouseup', (e) => { e.preventDefault(); actionUp(action) })

            // pointer leave (finger slides away)
            btn.addEventListener('mouseleave', (e) => { actionUp(action) })
        })

        // Joystick handling
        const joystick = document.getElementById('joystick')
        const stick = joystick ? joystick.querySelector('.stick') : null
        if (joystick && stick) {
            let dragging = false
            let origin = { x: 0, y: 0 }

            const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

            const onDown = (e) => {
                dragging = true
                const rect = joystick.getBoundingClientRect()
                origin.x = rect.left + rect.width / 2
                origin.y = rect.top + rect.height / 2
                stick.style.transition = '0s'
                e.preventDefault()
            }

            const onMove = (e) => {
                if (!dragging) return
                const point = e.touches ? e.touches[0] : e
                const dx = (point.clientX - origin.x)
                const dy = (point.clientY - origin.y)
                const max = joystick.clientWidth / 2 - 12
                const nx = clamp(dx / max, -1, 1)
                const ny = clamp(dy / max, -1, 1)

                // Update stick visual
                stick.style.transform = `translate(${nx * 40}px, ${ny * 40}px)`

                // Map to control: up is negative ny
                this.targetForce = -ny * this.maxForce
                this.targetSteer = -nx * this.maxSteerVal

                if (Math.abs(this.targetForce) > 0.01 && this.simpleCar && this.simpleCar.startEngine) this.simpleCar.startEngine()
                e.preventDefault()
            }

            const onUp = (e) => {
                dragging = false
                stick.style.transition = '200ms'
                stick.style.transform = 'translate(0,0)'
                this.targetForce = 0
                this.targetSteer = 0
            }

            stick.addEventListener('pointerdown', onDown)
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)

            // touch fallback
            stick.addEventListener('touchstart', onDown, { passive: false })
            window.addEventListener('touchmove', onMove, { passive: false })
            window.addEventListener('touchend', onUp)
        }

    }

    setupGroundDetection() {
        // Check if the car is on the ground every 100ms
        this.groundCheckInterval = setInterval(() => {
            // Get the chassis position
            const position = this.simpleCar.vehicle.chassisBody.position;

            // Ray starting from slightly above the car's position
            const start = new CANNON.Vec3(position.x, position.y - 0.3, position.z);
            const end = new CANNON.Vec3(position.x, position.y - 1.0, position.z);

            // Perform the raycast
            const result = new CANNON.RaycastResult();
            this.experience.worldPhysics.instance.rayTest(start, end, result);

            // If the ray hit something, the car is grounded
            if (result.hasHit) {
                if (!this.isGrounded) {
                    this.isGrounded = true;
                    this.jumpCount = 0;
                }
            } else {
                this.isGrounded = false;
            }
        }, 100);
    }

    jumpCar() {
        if (this.jumpCount < this.maxJumps) {
            // Apply upward impulse - less bouncy
            this.simpleCar.vehicle.chassisBody.applyImpulse(
                new CANNON.Vec3(0, 45, 0),
                new CANNON.Vec3(0, 0, 0)
            )
            this.jumpCount++
            this.isGrounded = false;
        }
    }

    changeCarColor() {
        // Select random Nintendo-style color from our palette (excluding current color)
        let currentColor;
        if (this.simpleCar.chassisMesh && this.simpleCar.chassisMesh.children[0].material) {
            currentColor = this.simpleCar.chassisMesh.children[0].material.color.getHex();
        }

        let randomColor;
        do {
            randomColor = this.nintendoColors[Math.floor(Math.random() * this.nintendoColors.length)];
        } while (randomColor === currentColor && this.nintendoColors.length > 1);

        // Apply to main chassis
        if (this.simpleCar.chassisMesh && this.simpleCar.chassisMesh.children[0]) {
            const bodyMesh = this.simpleCar.chassisMesh.children[0];

            if (bodyMesh.material) {
                // Update main chassis
                bodyMesh.material.color.setHex(randomColor);
                bodyMesh.material.emissive = new THREE.Color(randomColor).multiplyScalar(0.15);
            }
        }

        // Add a little particle effect for fun
        this.createColorChangeEffect(this.simpleCar.chassisMesh.position);

        console.log('Color changed to Nintendo style!');
    }

    createColorChangeEffect(position) {
        // Create a simple particle system for color change effect
        const particleCount = 15;
        const particleGeometry = new THREE.SphereGeometry(0.2, 8, 8);

        for (let i = 0; i < particleCount; i++) {
            // Random Nintendo color for each particle
            const particleColor = this.nintendoColors[Math.floor(Math.random() * this.nintendoColors.length)];

            const particleMaterial = new THREE.MeshBasicMaterial({
                color: particleColor,
                transparent: true,
                opacity: 1
            });

            const particle = new THREE.Mesh(particleGeometry, particleMaterial);

            // Position particles around the car
            particle.position.copy(position);
            particle.position.x += (Math.random() - 0.5) * 3;
            particle.position.y += (Math.random()) * 3;
            particle.position.z += (Math.random() - 0.5) * 5;

            this.experience.scene.add(particle);

            // Animate the particle
            const duration = 0.7 + Math.random() * 0.5;
            const startTime = this.experience.time.elapsed;

            const animate = () => {
                const elapsedTime = (this.experience.time.elapsed - startTime) / 1000;
                if (elapsedTime < duration) {
                    particle.position.y += 0.05;
                    particle.material.opacity = 1 - (elapsedTime / duration);
                    requestAnimationFrame(animate);
                } else {
                    this.experience.scene.remove(particle);
                    particle.geometry.dispose();
                    particle.material.dispose();
                }
            };

            animate();
        }
    }

    turboBoost() {
        // Apply forward boost impulse
        const direction = new CANNON.Vec3()

        // Get the forward direction of the car
        this.simpleCar.vehicle.chassisBody.quaternion.vmult(
            new CANNON.Vec3(0, 0, 1),
            direction
        )

        // Slightly stronger boost (tad faster overall)
        direction.scale(115, direction)

        // Apply the impulse
        this.simpleCar.vehicle.chassisBody.applyImpulse(
            direction,
            new CANNON.Vec3(0, 0, 0)
        )

        // Add a boost effect
        this.createBoostEffect(this.simpleCar.chassisMesh.position);
    }

    createBoostEffect(position) {
        // Create a boost trail effect
        const trailCount = 20;
        const trailGeometry = new THREE.SphereGeometry(0.2, 8, 8);

        for (let i = 0; i < trailCount; i++) {
            // Use flame colors for boost
            const trailColors = [0xFF5722, 0xFF9800, 0xFFEB3B];
            const trailColor = trailColors[Math.floor(Math.random() * trailColors.length)];

            const trailMaterial = new THREE.MeshBasicMaterial({
                color: trailColor,
                transparent: true,
                opacity: 0.8
            });

            const trail = new THREE.Mesh(trailGeometry, trailMaterial);

            // Get car direction and position behind it
            const direction = new THREE.Vector3();
            this.simpleCar.chassisMesh.getWorldDirection(direction);

            // Position behind car
            trail.position.copy(position);
            trail.position.x -= direction.x * (3 + Math.random() * 2);
            trail.position.y += 0.5;
            trail.position.z -= direction.z * (3 + Math.random() * 2);

            this.experience.scene.add(trail);

            // Animate the trail
            const duration = 0.5 + Math.random() * 0.3;
            const startTime = this.experience.time.elapsed;

            const animate = () => {
                const elapsedTime = (this.experience.time.elapsed - startTime) / 1000;
                if (elapsedTime < duration) {
                    trail.scale.multiplyScalar(0.95);
                    trail.material.opacity = 0.8 - (elapsedTime / duration);
                    requestAnimationFrame(animate);
                } else {
                    this.experience.scene.remove(trail);
                    trail.geometry.dispose();
                    trail.material.dispose();
                }
            };

            animate();
        }
    }

    setSteering() {
        document.addEventListener("keydown", (event) => {
            switch (event.key) {
                case "w":
                case "ArrowUp":
                    // Drive both rear wheels in the same direction
                    this.simpleCar.vehicle.setWheelForce(this.maxForce, 0)
                    this.simpleCar.vehicle.setWheelForce(this.maxForce, 1)
                    if (this.simpleCar && this.simpleCar.startEngine) this.simpleCar.startEngine()
                    break

                case 's':
                case 'ArrowDown':
                    this.simpleCar.vehicle.setWheelForce(-this.maxForce * 0.6, 0)
                    this.simpleCar.vehicle.setWheelForce(-this.maxForce * 0.6, 1)
                    break

                case 'a':
                case 'ArrowLeft':
                    this.simpleCar.vehicle.setSteeringValue(this.maxSteerVal, 2)
                    this.simpleCar.vehicle.setSteeringValue(this.maxSteerVal, 3)
                    break

                case 'd':
                case 'ArrowRight':
                    this.simpleCar.vehicle.setSteeringValue(-this.maxSteerVal, 2)
                    this.simpleCar.vehicle.setSteeringValue(-this.maxSteerVal, 3)
                    break

                case ' ':
                    // Jump with limited uses
                    this.jumpCar()
                    break

                case 'c':
                    // Change car color
                    this.changeCarColor()
                    break

                case 'b':
                    // Turbo boost
                    this.turboBoost()
                    break

                case 'r':
                    // Full reset - just like the button
                    window.location.reload()
                    break
            }
        })

        // Reset force on keyup
        document.addEventListener('keyup', (event) => {
            switch (event.key) {
                case 'w':
                case 'ArrowUp':
                    this.simpleCar.vehicle.setWheelForce(0, 0)
                    this.simpleCar.vehicle.setWheelForce(0, 1)
                    break

                case 's':
                case 'ArrowDown':
                    this.simpleCar.vehicle.setWheelForce(0, 0)
                    this.simpleCar.vehicle.setWheelForce(0, 1)
                    break

                case 'a':
                case 'ArrowLeft':
                    this.simpleCar.vehicle.setSteeringValue(0, 2)
                    this.simpleCar.vehicle.setSteeringValue(0, 3)
                    break

                case 'd':
                case 'ArrowRight':
                    this.simpleCar.vehicle.setSteeringValue(0, 2)
                    this.simpleCar.vehicle.setSteeringValue(0, 3)
                    break
            }
        })
    }
}



