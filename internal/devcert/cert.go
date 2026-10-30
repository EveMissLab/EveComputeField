package devcert

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

// Generate writes throwaway development-only CA/server/client credentials.
// Never commit or deploy its CA private key; use organizational PKI for production.
func Generate(out, host string) error {
	if host == "" {
		host = "127.0.0.1"
	}
	if err := os.MkdirAll(out, 0700); err != nil {
		return err
	}
	notBefore := time.Now().Add(-time.Hour)
	notAfter := time.Now().Add(7 * 24 * time.Hour)
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	serial := func() (*big.Int, error) { return rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128)) }
	caSerial, err := serial()
	if err != nil {
		return err
	}
	caTmpl := &x509.Certificate{
		SerialNumber: caSerial, Subject: pkix.Name{CommonName: "EveComputeField DEV CA"},
		NotBefore: notBefore, NotAfter: notAfter,
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign, BasicConstraintsValid: true, IsCA: true, MaxPathLenZero: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		return err
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		return err
	}
	if err := writePEM(filepath.Join(out, "ca.crt"), "CERTIFICATE", caDER); err != nil {
		return err
	}
	if err := writeKey(filepath.Join(out, "ca.key"), caKey); err != nil {
		return err
	}
	for _, role := range []string{"worker", "client"} {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return err
		}
		id, err := serial()
		if err != nil {
			return err
		}
		cert := &x509.Certificate{SerialNumber: id, Subject: pkix.Name{CommonName: "EveComputeField DEV " + role},
			NotBefore: notBefore, NotAfter: notAfter, KeyUsage: x509.KeyUsageDigitalSignature,
		}
		if role == "worker" {
			cert.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
			cert.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
			cert.DNSNames = []string{"localhost"}
			if ip := net.ParseIP(host); ip != nil {
				cert.IPAddresses = append(cert.IPAddresses, ip)
			} else {
				cert.DNSNames = append(cert.DNSNames, host)
			}
		} else {
			cert.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}
		}
		der, err := x509.CreateCertificate(rand.Reader, cert, caCert, &key.PublicKey, caKey)
		if err != nil {
			return err
		}
		if err := writePEM(filepath.Join(out, role+".crt"), "CERTIFICATE", der); err != nil {
			return err
		}
		if err := writeKey(filepath.Join(out, role+".key"), key); err != nil {
			return err
		}
	}
	return nil
}
func writePEM(path, typ string, der []byte) error {
	return os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: der}), 0600)
}
func writeKey(path string, key *ecdsa.PrivateKey) error {
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return fmt.Errorf("marshal private key: %w", err)
	}
	return writePEM(path, "EC PRIVATE KEY", der)
}
