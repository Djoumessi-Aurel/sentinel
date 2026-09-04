-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(190) NOT NULL,
    `displayName` VARCHAR(190) NOT NULL,
    `email` VARCHAR(255) NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'viewer',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(64) NULL,
    `updatedBy` VARCHAR(64) NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
