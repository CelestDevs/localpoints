// Menu mobile
document.querySelector('.mobile-menu').addEventListener('click', function() {
    document.querySelector('.nav-links').classList.toggle('active');
});

// Fechar menu ao clicar em um link
document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', function() {
        document.querySelector('.nav-links').classList.remove('active');
    });
});

// Animação simples ao rolar (sombra no header)
window.addEventListener('scroll', function() {
    const header = document.querySelector('header');
    if (window.scrollY > 50) {
        header.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.1)';
    } else {
        header.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
    }
});

// Fallback para imagens que não carregam (placeholder)
document.addEventListener('DOMContentLoaded', function() {
    const logoImages = document.querySelectorAll('.logo-parceira');

    logoImages.forEach(img => {
        // Fade-in suave
        img.style.opacity = '0';
        img.style.transition = 'opacity 0.3s ease-in';

        img.addEventListener('load', function() {
            this.style.opacity = '1';
        });

        img.addEventListener('error', function() {
            // Substitui por placeholder ao falhar o carregamento
            const placeholder = document.createElement('div');
            placeholder.className = 'logo-placeholder';
            placeholder.textContent = 'Point'; // Você pode mudar o texto para algo genérico ou por loja
            this.parentElement.appendChild(placeholder);
            this.style.display = 'none';
        });

        // Caso a imagem já esteja em cache
        if (img.complete && img.naturalHeight !== 0) {
            img.style.opacity = '1';
        }
    });
});
