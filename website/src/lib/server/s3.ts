import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { processImage } from './image.js';

const s3Client = new S3Client({
    endpoint: publicEnv.PUBLIC_B2_ENDPOINT,
    region: publicEnv.PUBLIC_B2_REGION,
    credentials: {
        accessKeyId: env.PRIVATE_B2_KEY_ID,
        secretAccessKey: env.PRIVATE_B2_APP_KEY
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
});

export async function generatePresignedUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: publicEnv.PUBLIC_B2_BUCKET,
        Key: key,
        ContentType: contentType
    });

    return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
}

export async function deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
        Bucket: publicEnv.PUBLIC_B2_BUCKET,
        Key: key
    });

    await s3Client.send(command);
}

export async function generateDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
        Bucket: publicEnv.PUBLIC_B2_BUCKET,
        Key: key
    });

    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

export async function uploadProfilePicture(
    identifier: string, // Can be user ID or a unique ID from social provider
    body: Uint8Array,
    contentType: string,
): Promise<string> {
    if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('Invalid file type. Only images are allowed.');
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(contentType.toLowerCase())) {
        throw new Error('Unsupported image format. Only JPEG, PNG, GIF, and WebP are allowed.');
    }

    const processedImage = await processImage(Buffer.from(body));

    const key = `avatars/${identifier}.webp`;

    const command = new PutObjectCommand({
        Bucket: publicEnv.PUBLIC_B2_BUCKET,
        Key: key,
        Body: processedImage.buffer,
        ContentType: processedImage.contentType,
        ContentLength: processedImage.size,
    });

    await s3Client.send(command);
    return key;
}

export async function uploadCoinIcon(
    coinSymbol: string,
    body: Uint8Array,
    contentType: string,
): Promise<string> {
    if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('Invalid file type. Only images are allowed.');
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(contentType.toLowerCase())) {
        throw new Error('Unsupported image format. Only JPEG, PNG, GIF, and WebP are allowed.');
    }

    const processedImage = await processImage(Buffer.from(body));

    const key = `coins/${coinSymbol.toLowerCase()}.webp`;

    const command = new PutObjectCommand({
        Bucket: publicEnv.PUBLIC_B2_BUCKET,
        Key: key,
        Body: processedImage.buffer,
        ContentType: processedImage.contentType,
        ContentLength: processedImage.size,
    });

    await s3Client.send(command);
    return key;
}

export { s3Client };
