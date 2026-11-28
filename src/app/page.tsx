export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 16px", lineHeight: 1.5 }}>
      <h1>PopiCert</h1>
      <p>Certificados verificables de las formaciones de PopiAI, emitidos como credenciales Open Badges 3.0.</p>
      <p>
        Si tienes un enlace a un certificado, ábrelo para ver su estado. Cualquiera puede comprobar su
        autenticidad en la <a href="/verificar">página de verificación</a>.
      </p>
    </main>
  );
}
