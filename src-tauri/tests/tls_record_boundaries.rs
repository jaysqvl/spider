//! Regression controls for GHSA-2mjx-qc3c-rqvc.
//! These synthetic, in-memory flights never contact the updater or a live server.
use std::{io::Cursor, sync::Arc};

use rustls::{
    crypto::ring, pki_types::ServerName, server::Acceptor, ClientConfig, ClientConnection, Error,
    PeerMisbehaved, RootCertStore,
};

const ENCRYPTED_EXTENSIONS: &[u8] = &[8, 0, 0, 2, 0, 0];

fn client_hello() -> (ClientConnection, Vec<u8>) {
    let mut provider = ring::default_provider();
    provider.kx_groups = vec![ring::kx_group::X25519];
    let config = ClientConfig::builder_with_provider(Arc::new(provider))
        .with_protocol_versions(&[&rustls::version::TLS13])
        .unwrap()
        .with_root_certificates(RootCertStore::empty())
        .with_no_client_auth();
    let name = ServerName::try_from("example.test").unwrap();
    let mut client = ClientConnection::new(Arc::new(config), name).unwrap();
    let mut hello = Vec::new();
    client.write_tls(&mut hello).unwrap();
    assert_eq!(hello[0], 22);
    assert_eq!(hello[5], 1);
    (client, hello)
}

fn record(handshakes: &[u8]) -> Vec<u8> {
    let mut bytes = vec![22, 3, 3];
    bytes.extend_from_slice(&(handshakes.len() as u16).to_be_bytes());
    bytes.extend_from_slice(handshakes);
    bytes
}

fn server_hello(client_hello: &[u8]) -> Vec<u8> {
    let session_len = client_hello[43] as usize;
    let session = &client_hello[44..44 + session_len];
    let mut body = vec![3, 3];
    body.extend_from_slice(&[0x42; 32]);
    body.push(session_len as u8);
    body.extend_from_slice(session);
    body.extend_from_slice(&[0x13, 0x01, 0]); // AES-128-GCM, null compression.
    let mut extensions = vec![0, 43, 0, 2, 3, 4, 0, 51, 0, 36, 0, 29, 0, 32];
    let mut public_key = [0; 32];
    public_key[0] = 9; // Valid X25519 base point; no test certificate/key needed.
    extensions.extend_from_slice(&public_key);
    body.extend_from_slice(&(extensions.len() as u16).to_be_bytes());
    body.extend_from_slice(&extensions);
    let mut handshake = vec![2, 0];
    handshake.extend_from_slice(&(body.len() as u16).to_be_bytes());
    handshake.extend_from_slice(&body);
    handshake
}

#[test]
fn client_rejects_plaintext_extensions_in_server_hello_record() {
    let (mut client, hello) = client_hello();
    let mut flight = server_hello(&hello);
    flight.extend_from_slice(ENCRYPTED_EXTENSIONS);
    client.read_tls(&mut Cursor::new(record(&flight))).unwrap();
    assert_eq!(
        client.process_new_packets().unwrap_err(),
        Error::PeerMisbehaved(PeerMisbehaved::KeyEpochWithPendingFragment)
    );
}

#[test]
fn acceptor_rejects_followup_messages_in_client_hello_record() {
    let (_, hello) = client_hello();
    let mut flight = hello[5..].to_vec();
    flight.extend_from_slice(ENCRYPTED_EXTENSIONS);
    let mut acceptor = Acceptor::default();
    acceptor
        .read_tls(&mut Cursor::new(record(&flight)))
        .unwrap();
    let result = acceptor.accept();
    assert!(matches!(
        result,
        Err((
            Error::PeerMisbehaved(PeerMisbehaved::KeyEpochWithPendingFragment),
            _
        ))
    ));
}

#[test]
fn ordinary_separate_handshake_boundaries_are_accepted() {
    let (mut client, hello) = client_hello();
    let mut acceptor = Acceptor::default();
    acceptor.read_tls(&mut Cursor::new(&hello)).unwrap();
    assert!(acceptor.accept().unwrap().is_some());
    client
        .read_tls(&mut Cursor::new(record(&server_hello(&hello))))
        .unwrap();
    client.process_new_packets().unwrap();
    assert!(client.is_handshaking());
}
