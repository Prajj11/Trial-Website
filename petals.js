/**
 * Cherry Blossom Petals Animation
 */
(function() {
    const canvas = document.createElement('canvas');
    canvas.id = 'petals-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none'; // Ensure user can click elements behind it
    canvas.style.zIndex = '9999'; // Stay on top of everything
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let width, height;
    let petals = [];

    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
    }

    window.addEventListener('resize', resize);
    resize();

    class Petal {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height - height; // Start above screen
            this.w = 8 + Math.random() * 8; // Width
            this.h = 12 + Math.random() * 10; // Height
            this.opacity = 0.5 + Math.random() * 0.5;
            this.flip = Math.random();
            this.flipSpeed = Math.random() * 0.03 + 0.01;
            this.xSpeed = 0.5 + Math.random() * 1.5; // Wind effect
            this.ySpeed = 1 + Math.random() * 1.5; // Gravity effect
            this.rotation = Math.random() * Math.PI * 2;
            this.rotationSpeed = Math.random() * 0.02 - 0.01;
            this.setTheme();
        }

        setTheme() {
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            if (isLight) {
                // Dark autumn/maple colors for light mode
                const colors = ['40, 20, 10', '60, 25, 10', '30, 15, 5', '20, 20, 20'];
                this.color = colors[Math.floor(Math.random() * colors.length)];
                this.type = 'maple';
            } else {
                // Soft pink cherry blossom colors for dark mode
                const colors = ['255, 183, 197', '255, 158, 175', '255, 192, 203'];
                this.color = colors[Math.floor(Math.random() * colors.length)];
                this.type = 'sakura';
            }
        }

        draw() {
            // Check theme dynamically
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            const expectedType = isLight ? 'maple' : 'sakura';
            if (this.type !== expectedType) {
                this.setTheme();
            }

            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);
            ctx.scale(Math.cos(this.flip), 1); // 3D flip effect
            
            ctx.beginPath();
            
            if (this.type === 'sakura') {
                // A realistic cherry blossom petal shape
                ctx.moveTo(0, this.h / 2); // Bottom tip
                ctx.bezierCurveTo(this.w, this.h / 4, this.w / 1.5, -this.h / 2, 0, -this.h / 2.5); // Right curve with a cleft
                ctx.bezierCurveTo(-this.w / 1.5, -this.h / 2, -this.w, this.h / 4, 0, this.h / 2); // Left curve back to tip
            } else {
                // A maple leaf shape
                ctx.scale(this.w / 10, this.h / 10); 
                ctx.moveTo(0, 8);
                // stem
                ctx.lineTo(0.5, 12);
                ctx.lineTo(-0.5, 12);
                ctx.lineTo(0, 8);
                // right side
                ctx.lineTo(2, 7);
                ctx.lineTo(8, 8);
                ctx.lineTo(6, 4);
                ctx.lineTo(10, 2);
                ctx.lineTo(6, 0);
                ctx.lineTo(8, -4);
                ctx.lineTo(3, -2);
                ctx.lineTo(4, -7);
                ctx.lineTo(1, -4);
                // top tip
                ctx.lineTo(0, -10);
                // left side
                ctx.lineTo(-1, -4);
                ctx.lineTo(-4, -7);
                ctx.lineTo(-3, -2);
                ctx.lineTo(-8, -4);
                ctx.lineTo(-6, 0);
                ctx.lineTo(-10, 2);
                ctx.lineTo(-6, 4);
                ctx.lineTo(-8, 8);
                ctx.lineTo(-2, 7);
                ctx.lineTo(0, 8);
            }

            ctx.fillStyle = `rgba(${this.color}, ${this.opacity})`;
            ctx.fill();
            
            ctx.restore();
        }

        update() {
            this.y += this.ySpeed;
            this.x += this.xSpeed;
            this.rotation += this.rotationSpeed;
            this.flip += this.flipSpeed;

            // Reset petal when it goes off screen
            if (this.y > height + this.h || this.x > width + this.w) {
                this.x = Math.random() * width - width * 0.2; // Spawn slightly left to account for wind
                this.y = -this.h;
                this.setTheme(); // update theme on respawn in case it changed
            }
        }
    }

    const petalCount = 60; // Adjust for density
    for (let i = 0; i < petalCount; i++) {
        petals.push(new Petal());
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);
        petals.forEach(petal => {
            petal.update();
            petal.draw();
        });
        requestAnimationFrame(animate);
    }

    animate();
})();
