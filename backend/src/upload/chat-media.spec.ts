import { clasificarMediaDeChat, sniffAudioContentType } from './chat-media';

const relleno = (...bytes: number[]) =>
  Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);
const ascii = (texto: string, desplazamiento = 0) =>
  Buffer.concat([
    Buffer.alloc(desplazamiento),
    Buffer.from(texto, 'ascii'),
    Buffer.alloc(32),
  ]);

describe('clasificarMediaDeChat: el tipo sale de los bytes', () => {
  it('reconoce una foto JPEG aunque el navegador declare otra cosa', () => {
    expect(
      clasificarMediaDeChat(relleno(0xff, 0xd8, 0xff), 'text/html'),
    ).toEqual({
      kind: 'foto',
      mimeType: 'image/jpeg',
    });
  });

  it('reconoce los audios que graba un navegador', () => {
    expect(clasificarMediaDeChat(ascii('OggS'), '')?.mimeType).toBe(
      'audio/ogg',
    );
    expect(
      clasificarMediaDeChat(
        relleno(0x1a, 0x45, 0xdf, 0xa3),
        'audio/webm;codecs=opus',
      ),
    ).toEqual({ kind: 'audio', mimeType: 'audio/webm' });
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypM4A '),
      Buffer.alloc(32),
    ]);
    expect(clasificarMediaDeChat(mp4, 'audio/mp4')).toEqual({
      kind: 'audio',
      mimeType: 'audio/mp4',
    });
  });

  it('WebM y MP4 declarados como video no pasan por audio', () => {
    expect(
      sniffAudioContentType(relleno(0x1a, 0x45, 0xdf, 0xa3), 'video/webm'),
    ).toBeNull();
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(32),
    ]);
    expect(sniffAudioContentType(mp4, 'video/mp4')).toBeNull();
  });

  it('rechaza lo que no es foto ni audio, como un HTML o un ejecutable', () => {
    expect(
      clasificarMediaDeChat(
        Buffer.from('<html><script>x</script></html>'),
        'image/png',
      ),
    ).toBeNull();
    expect(
      clasificarMediaDeChat(Buffer.from('MZ\x90\x00'), 'audio/mpeg'),
    ).toBeNull();
    expect(clasificarMediaDeChat(Buffer.alloc(0), 'image/png')).toBeNull();
  });
});
